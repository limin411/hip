//! SFTP tree + transfer bound to an alive SSH session (Cargo feature `ssh`).
//!
//! Commands: sftp_ls / sftp_download / sftp_upload / sftp_cancel
//!           (+ optional sftp_mkdir / sftp_remove).
//! Events: `sftp:progress` { terminalId, opId, phase, bytes, total? }.
//!
//! Path rules: every public entry point calls `normalize_remote_path` once
//! (see `sftp_path::sanitize_remote_path` + design § SFTP security algorithm).

#![cfg(feature = "ssh")]

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;

use crate::sftp_path::{
    join_remote, remote_basename, remote_temp_path, sanitize_remote_path,
};
use crate::ssh_session::{
    ensure_sftp, get_alive_session, SshManager, SshSession, SESSION_CLOSED,
};

/// Max concurrent transfer ops process-wide (design: global = 2).
const MAX_GLOBAL_TRANSFERS: usize = 2;
/// Design v1: one transfer at a time per SSH/SFTP session.
const MAX_PER_SESSION_TRANSFERS: usize = 1;
/// Progress emit throttle.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);
const PROGRESS_BYTES: u64 = 256 * 1024;
const IO_BUF: usize = 64 * 1024;

fn transfer_key(terminal_id: &str, op_id: &str) -> String {
    format!("{terminal_id}\0{op_id}")
}

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpLsResult {
    /// Normalized absolute remote directory path.
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpProgressEvent {
    terminal_id: String,
    op_id: String,
    /// started | progress | completed | cancelled | error
    phase: String,
    bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

// ── Transfer cancel registry ────────────────────────────────────────────────

pub struct SftpTransferState {
    /// Keys: `terminalId\0opId` so cancel is scoped to a session (Issue 9).
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Active op count per terminal (Issue 4: max 1 per session).
    per_session: Mutex<HashMap<String, usize>>,
    active: AtomicUsize,
}

impl SftpTransferState {
    pub fn new() -> Self {
        Self {
            cancels: Mutex::new(HashMap::new()),
            per_session: Mutex::new(HashMap::new()),
            active: AtomicUsize::new(0),
        }
    }

    fn begin(&self, terminal_id: &str, op_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut per = self.per_session.lock().unwrap();
        let sess_n = *per.get(terminal_id).unwrap_or(&0);
        if sess_n >= MAX_PER_SESSION_TRANSFERS {
            return Err(
                "Only one SFTP transfer per terminal at a time. Wait or cancel the active transfer."
                    .into(),
            );
        }
        let n = self.active.fetch_add(1, Ordering::SeqCst);
        if n >= MAX_GLOBAL_TRANSFERS {
            self.active.fetch_sub(1, Ordering::SeqCst);
            return Err(format!(
                "Too many concurrent SFTP transfers (max {MAX_GLOBAL_TRANSFERS})"
            ));
        }
        *per.entry(terminal_id.to_string()).or_insert(0) += 1;
        drop(per);

        let flag = Arc::new(AtomicBool::new(false));
        self.cancels.lock().unwrap().insert(
            transfer_key(terminal_id, op_id),
            Arc::clone(&flag),
        );
        Ok(flag)
    }

    fn end(&self, terminal_id: &str, op_id: &str) {
        self.cancels
            .lock()
            .unwrap()
            .remove(&transfer_key(terminal_id, op_id));
        let mut per = self.per_session.lock().unwrap();
        if let Some(c) = per.get_mut(terminal_id) {
            *c = c.saturating_sub(1);
            if *c == 0 {
                per.remove(terminal_id);
            }
        }
        self.active.fetch_sub(1, Ordering::SeqCst);
    }

    fn cancel(&self, terminal_id: &str, op_id: &str) -> bool {
        if let Some(f) = self
            .cancels
            .lock()
            .unwrap()
            .get(&transfer_key(terminal_id, op_id))
        {
            f.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    /// Cancel every in-flight transfer for a terminal (Issue 8 — session close).
    pub fn cancel_all_for_terminal(&self, terminal_id: &str) {
        let prefix = format!("{terminal_id}\0");
        let map = self.cancels.lock().unwrap();
        for (k, f) in map.iter() {
            if k.starts_with(&prefix) {
                f.store(true, Ordering::SeqCst);
            }
        }
    }
}

impl Default for SftpTransferState {
    fn default() -> Self {
        Self::new()
    }
}

// ── Path normalize (session-aware) ──────────────────────────────────────────

/// All public sftp_* entry points call this once.
async fn normalize_remote_path(
    sftp: &SftpSession,
    input: &str,
) -> Result<String, String> {
    let sanitized = sanitize_remote_path(input)?;
    // Sentinel: empty / "." → server home or session cwd via realpath.
    if sanitized == "." {
        return sftp
            .canonicalize(".")
            .await
            .map_err(|e| format!("SFTP realpath failed: {e}"));
    }
    // Prefer absolute via realpath when path is relative.
    if !sanitized.starts_with('/') {
        return sftp
            .canonicalize(&sanitized)
            .await
            .map_err(|e| format!("SFTP realpath failed: {e}"));
    }
    Ok(sanitized)
}

fn emit_progress(
    app: &AppHandle,
    terminal_id: &str,
    op_id: &str,
    phase: &str,
    bytes: u64,
    total: Option<u64>,
    message: Option<String>,
) {
    let _ = app.emit(
        "sftp:progress",
        SftpProgressEvent {
            terminal_id: terminal_id.to_string(),
            op_id: op_id.to_string(),
            phase: phase.to_string(),
            bytes,
            total,
            message,
        },
    );
}

async fn require_sftp(
    manager: &SshManager,
    terminal_id: &str,
) -> Result<(Arc<SshSession>, Arc<SftpSession>), String> {
    if terminal_id.is_empty() || !terminal_id.starts_with("tm_") {
        return Err("sftp requires managed terminal id (tm_*)".into());
    }
    let sess = get_alive_session(manager, terminal_id)?;
    let sftp = ensure_sftp(&sess).await?;
    Ok((sess, sftp))
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_ls(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
) -> Result<SftpLsResult, String> {
    let (_sess, sftp) = require_sftp(&manager, &terminal_id).await?;
    let dir = normalize_remote_path(&sftp, &path).await?;

    let read = sftp
        .read_dir(&dir)
        .await
        .map_err(|e| format!("SFTP ls failed: {e}"))?;

    let mut entries: Vec<SftpEntry> = Vec::new();
    for entry in read {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        // Match workspace-fs: hide dotfiles/dot-dirs.
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        let size = if is_dir {
            None
        } else {
            entry.metadata().size
        };
        let full = join_remote(&dir, &name);
        entries.push(SftpEntry {
            name,
            path: full,
            is_dir,
            size,
        });
    }
    // Directories first, then name (case-insensitive).
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(SftpLsResult {
        path: dir,
        entries,
    })
}

#[tauri::command]
pub async fn sftp_mkdir(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
) -> Result<(), String> {
    let (_sess, sftp) = require_sftp(&manager, &terminal_id).await?;
    let dir = normalize_remote_path(&sftp, &path).await?;
    sftp.create_dir(&dir)
        .await
        .map_err(|e| format!("SFTP mkdir failed: {e}"))
}

/// Read a remote text file via SFTP (read-only; cap 256KB default). P0 D9.
#[tauri::command]
pub async fn sftp_read_file(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    let (_sess, sftp) = require_sftp(&manager, &terminal_id).await?;
    let remote = normalize_remote_path(&sftp, &path).await?;
    let cap = max_bytes
        .unwrap_or(256 * 1024)
        .clamp(1024, 256 * 1024);

    let mut file = sftp
        .open(&remote)
        .await
        .map_err(|e| format!("SFTP open failed: {e}"))?;
    let mut buf = vec![0u8; cap + 1];
    let mut n = 0usize;
    while n < buf.len() {
        let read = file
            .read(&mut buf[n..])
            .await
            .map_err(|e| format!("SFTP read failed: {e}"))?;
        if read == 0 {
            break;
        }
        n += read;
    }
    let _ = file.shutdown().await;

    let truncated = n > cap;
    let bytes = if truncated { &buf[..cap] } else { &buf[..n] };
    let text = String::from_utf8_lossy(bytes).into_owned();
    let note = if truncated {
        format!("\n…(file truncated to {cap} bytes)")
    } else {
        String::new()
    };
    Ok(format!("{text}{note}"))
}

#[tauri::command]
pub async fn sftp_remove(
    manager: State<'_, SshManager>,
    terminal_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let (_sess, sftp) = require_sftp(&manager, &terminal_id).await?;
    let target = normalize_remote_path(&sftp, &path).await?;
    if is_dir {
        sftp.remove_dir(&target)
            .await
            .map_err(|e| format!("SFTP rmdir failed: {e}"))
    } else {
        sftp.remove_file(&target)
            .await
            .map_err(|e| format!("SFTP remove failed: {e}"))
    }
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    manager: State<'_, SshManager>,
    transfers: State<'_, SftpTransferState>,
    terminal_id: String,
    remote_path: String,
    local_path: String,
    force: bool,
    op_id: String,
) -> Result<(), String> {
    if op_id.trim().is_empty() {
        return Err("opId is required".into());
    }
    let local = PathBuf::from(&local_path);
    validate_local_transfer_path(&local, true)?;

    let cancel = transfers.begin(&terminal_id, &op_id)?;
    let result = download_inner(
        &app,
        &manager,
        &terminal_id,
        &remote_path,
        &local,
        force,
        &op_id,
        &cancel,
    )
    .await;
    transfers.end(&terminal_id, &op_id);
    result
}

async fn download_inner(
    app: &AppHandle,
    manager: &SshManager,
    terminal_id: &str,
    remote_path: &str,
    local: &Path,
    force: bool,
    op_id: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (_sess, sftp) = require_sftp(manager, terminal_id).await?;
    let remote = normalize_remote_path(&sftp, remote_path).await?;

    if local.exists() && !force {
        return Err("AlreadyExists".into());
    }
    let parent = local
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "local path has no parent directory".to_string())?;
    if !parent.is_dir() {
        return Err(format!(
            "local parent directory missing: {}",
            parent.display()
        ));
    }

    let total = sftp
        .metadata(&remote)
        .await
        .ok()
        .and_then(|m| m.size);

    let temp = temp_path_for(local, op_id);
    // Clean leftover temp from a prior crash.
    let _ = tokio::fs::remove_file(&temp).await;

    emit_progress(app, terminal_id, op_id, "started", 0, total, None);

    let mut remote_file = sftp
        .open(&remote)
        .await
        .map_err(|e| format!("SFTP open remote failed: {e}"))?;
    let mut local_file = tokio::fs::File::create(&temp)
        .await
        .map_err(|e| format!("create temp file failed: {e}"))?;

    let mut buf = vec![0u8; IO_BUF];
    let mut bytes: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_bytes: u64 = 0;

    let transfer = async {
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| format!("SFTP read failed: {e}"))?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| format!("local write failed: {e}"))?;
            bytes += n as u64;
            if last_emit.elapsed() >= PROGRESS_EVERY || bytes - last_bytes >= PROGRESS_BYTES {
                emit_progress(app, terminal_id, op_id, "progress", bytes, total, None);
                last_emit = Instant::now();
                last_bytes = bytes;
            }
        }
        local_file
            .sync_all()
            .await
            .map_err(|e| format!("fsync failed: {e}"))?;
        Ok::<(), String>(())
    }
    .await;

    // Always drop handles before rename / cleanup.
    drop(local_file);
    let _ = remote_file.shutdown().await;

    match transfer {
        Ok(()) => {
            if cancel.load(Ordering::SeqCst) {
                let _ = tokio::fs::remove_file(&temp).await;
                emit_progress(
                    app,
                    terminal_id,
                    op_id,
                    "cancelled",
                    bytes,
                    total,
                    None,
                );
                return Err("cancelled".into());
            }
            // Safer force replace: move dest → bak, temp → dest, drop bak (Issue 5).
            promote_local_temp(&temp, local).await?;
            emit_progress(app, terminal_id, op_id, "completed", bytes, total, None);
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp).await;
            let phase = if e == "cancelled" || cancel.load(Ordering::SeqCst) {
                "cancelled"
            } else {
                "error"
            };
            emit_progress(
                app,
                terminal_id,
                op_id,
                phase,
                bytes,
                total,
                Some(e.clone()),
            );
            Err(e)
        }
    }
}

/// Move completed download temp into place without a long window where dest is gone.
async fn promote_local_temp(temp: &Path, dest: &Path) -> Result<(), String> {
    if !dest.exists() {
        return tokio::fs::rename(temp, dest)
            .await
            .map_err(|e| format!("rename temp → dest failed: {e}"));
    }
    let bak = dest.with_file_name(format!(
        ".{}.hip-sftp-bak",
        dest.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download")
    ));
    let _ = tokio::fs::remove_file(&bak).await;
    tokio::fs::rename(dest, &bak)
        .await
        .map_err(|e| format!("rename dest → bak failed: {e}"))?;
    match tokio::fs::rename(temp, dest).await {
        Ok(()) => {
            let _ = tokio::fs::remove_file(&bak).await;
            Ok(())
        }
        Err(e) => {
            // Restore previous destination.
            let _ = tokio::fs::rename(&bak, dest).await;
            let _ = tokio::fs::remove_file(temp).await;
            Err(format!("rename temp → dest failed: {e}"))
        }
    }
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    manager: State<'_, SshManager>,
    transfers: State<'_, SftpTransferState>,
    terminal_id: String,
    local_path: String,
    remote_path: String,
    force: bool,
    op_id: String,
) -> Result<(), String> {
    if op_id.trim().is_empty() {
        return Err("opId is required".into());
    }
    let local = PathBuf::from(&local_path);
    validate_local_transfer_path(&local, false)?;
    if !local.is_file() {
        return Err(format!("local file not found: {}", local.display()));
    }

    let cancel = transfers.begin(&terminal_id, &op_id)?;
    let result = upload_inner(
        &app,
        &manager,
        &terminal_id,
        &local,
        &remote_path,
        force,
        &op_id,
        &cancel,
    )
    .await;
    transfers.end(&terminal_id, &op_id);
    result
}

async fn upload_inner(
    app: &AppHandle,
    manager: &SshManager,
    terminal_id: &str,
    local: &Path,
    remote_path: &str,
    force: bool,
    op_id: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (_sess, sftp) = require_sftp(manager, terminal_id).await?;
    let remote = normalize_remote_path(&sftp, remote_path).await?;

    let exists = sftp
        .try_exists(&remote)
        .await
        .map_err(|e| format!("SFTP exists check failed: {e}"))?;
    if exists && !force {
        return Err("AlreadyExists".into());
    }

    let total = tokio::fs::metadata(local)
        .await
        .ok()
        .map(|m| m.len());

    // Always write to a sibling temp on the remote; promote via rename (Issue 3).
    // Destination is never truncated until a successful promote.
    let remote_temp = remote_temp_path(&remote, op_id);
    let _ = sftp.remove_file(&remote_temp).await;

    emit_progress(app, terminal_id, op_id, "started", 0, total, None);

    // Exclusive create of the temp when possible (Issue 6 spirit — no clobber of unexpected peers).
    let open_flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE | OpenFlags::TRUNCATE;
    let mut remote_file = match sftp.open_with_flags(&remote_temp, open_flags).await {
        Ok(f) => f,
        Err(_) => {
            // Some servers are picky about EXCLUDE+TRUNCATE; fall back after remove.
            let _ = sftp.remove_file(&remote_temp).await;
            sftp.open_with_flags(
                &remote_temp,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| format!("SFTP create remote temp failed: {e}"))?
        }
    };

    let mut local_file = tokio::fs::File::open(local)
        .await
        .map_err(|e| format!("open local file failed: {e}"))?;

    let mut buf = vec![0u8; IO_BUF];
    let mut bytes: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_bytes: u64 = 0;

    let transfer = async {
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            let n = local_file
                .read(&mut buf)
                .await
                .map_err(|e| format!("local read failed: {e}"))?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| format!("SFTP write failed: {e}"))?;
            bytes += n as u64;
            if last_emit.elapsed() >= PROGRESS_EVERY || bytes - last_bytes >= PROGRESS_BYTES {
                emit_progress(app, terminal_id, op_id, "progress", bytes, total, None);
                last_emit = Instant::now();
                last_bytes = bytes;
            }
        }
        remote_file
            .flush()
            .await
            .map_err(|e| format!("SFTP flush failed: {e}"))?;
        Ok::<(), String>(())
    }
    .await;

    let _ = remote_file.shutdown().await;

    match transfer {
        Ok(()) => {
            if cancel.load(Ordering::SeqCst) {
                let _ = sftp.remove_file(&remote_temp).await;
                emit_progress(
                    app,
                    terminal_id,
                    op_id,
                    "cancelled",
                    bytes,
                    total,
                    None,
                );
                return Err("cancelled".into());
            }
            // Re-check existence for !force (TOCTOU between check and promote).
            let now_exists = sftp.try_exists(&remote).await.unwrap_or(false);
            if now_exists && !force {
                let _ = sftp.remove_file(&remote_temp).await;
                return Err("AlreadyExists".into());
            }
            // Promote temp → dest. If overwriting, move dest aside first so a failed
            // rename never leaves the user with neither file nor a truncated dest.
            let bak = if now_exists {
                Some(remote_temp_path(
                    &format!("{remote}.bak"),
                    &format!("bak-{op_id}"),
                ))
            } else {
                None
            };
            if let Some(ref bak_path) = bak {
                let _ = sftp.remove_file(bak_path).await;
                if sftp.rename(&remote, bak_path).await.is_err() {
                    // Fallback when rename-over is unsupported: remove dest only after
                    // the complete temp is ready (still better than truncate-in-place).
                    let _ = sftp.remove_file(&remote).await;
                }
            }
            if let Err(e) = sftp.rename(&remote_temp, &remote).await {
                if let Some(ref bak_path) = bak {
                    let _ = sftp.rename(bak_path, &remote).await;
                }
                let _ = sftp.remove_file(&remote_temp).await;
                return Err(format!("SFTP rename temp → dest failed: {e}"));
            }
            if let Some(ref bak_path) = bak {
                let _ = sftp.remove_file(bak_path).await;
            }
            emit_progress(app, terminal_id, op_id, "completed", bytes, total, None);
            Ok(())
        }
        Err(e) => {
            // Only delete the partial temp — never the original destination (Issue 3).
            let _ = sftp.remove_file(&remote_temp).await;
            let phase = if e == "cancelled" || cancel.load(Ordering::SeqCst) {
                "cancelled"
            } else {
                "error"
            };
            emit_progress(
                app,
                terminal_id,
                op_id,
                phase,
                bytes,
                total,
                Some(e.clone()),
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn sftp_cancel(
    transfers: State<'_, SftpTransferState>,
    terminal_id: String,
    op_id: String,
) -> Result<(), String> {
    // Scoped by (terminalId, opId). Empty op_id cancels all for the terminal (Issue 8).
    if op_id.trim().is_empty() {
        transfers.cancel_all_for_terminal(&terminal_id);
        return Ok(());
    }
    let _ = transfers.cancel(&terminal_id, &op_id);
    Ok(())
}

// ── Local path guards ───────────────────────────────────────────────────────

/// Dialog-chosen local path: parent must exist for download dest; file must exist for upload.
fn validate_local_transfer_path(path: &Path, for_download: bool) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("local path is empty".into());
    }
    // Reject NUL in path components (path traversal via weird bytes).
    if path.to_string_lossy().contains('\0') {
        return Err("local path contains NUL".into());
    }
    if for_download {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| "local path has no parent directory".to_string())?;
        // Canonicalize parent when possible (symlink-aware).
        match parent.canonicalize() {
            Ok(_) => Ok(()),
            Err(_) if parent.is_dir() => Ok(()),
            Err(e) => Err(format!(
                "local parent directory missing or inaccessible: {e}"
            )),
        }
    } else {
        Ok(())
    }
}

fn temp_path_for(dest: &Path, op_id: &str) -> PathBuf {
    let file_name = dest
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    // Sanitize op_id for filesystem safety.
    let safe_op: String = op_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(32)
        .collect();
    let temp_name = format!(".{file_name}.hip-sftp-partial-{safe_op}");
    match dest.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.join(temp_name),
        _ => PathBuf::from(temp_name),
    }
}

// Re-export SESSION_CLOSED for tests/docs.
#[allow(dead_code)]
const _SESSION_CLOSED: &str = SESSION_CLOSED;
#[allow(dead_code)]
fn _basename_check(p: &str) -> &str {
    remote_basename(p)
}
