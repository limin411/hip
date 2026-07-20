//! Production SSH interactive shell via `russh` (Cargo feature `ssh`).
//!
//! Commands: ssh_open / ssh_write / ssh_resize / ssh_close / ssh_list.
//! Events: `ssh:data` (base64) / `ssh:exit` (generation required).
//! Secrets loaded only in Rust via `get_secret_value` — never exposed to renderer.

#![cfg(feature = "ssh")]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

use russh::client::{self, Handle};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelMsg, ChannelWriteHalf, Disconnect};

use crate::ssh_known_hosts::{
    get_pin, host_key_id, load_known_hosts, save_known_hosts, tofu_check_strings, trust_host,
    HostKeyDecision, KnownHostEntry,
};
use crate::ssh_path::expand_tilde_path;
use crate::terminal_budget::{TerminalBudget, MAX_INTERACTIVE_TERMINALS};
use crate::terminal_hosts::{load_catalog, TerminalHost};

// Coalesce constants — match PTY spirit (design).
const COALESCE_BYTES: usize = 32 * 1024;
const COALESCE_MS: u64 = 12;
const MAX_EMIT_RAW: usize = 192 * 1024;
const MAX_QUEUE_CHUNKS: usize = 64;
const MAX_QUEUE_BYTES: usize = 1024 * 1024;

// ── Events ──────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshDataEvent {
    terminal_id: String,
    data: String, // base64
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SshExitEvent {
    terminal_id: String,
    code: Option<i32>,
    generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenResult {
    pub reused: bool,
    pub generation: u64,
}

/// Structured error payload for host-key mismatch (JSON string on Err).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyMismatchError {
    code: &'static str,
    hostname: String,
    port: u16,
    fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_fingerprint: Option<String>,
    /// OpenSSH public key line of the *new* server key (for trust update).
    public_key: String,
}

fn mismatch_err(
    hostname: &str,
    port: u16,
    fingerprint: &str,
    previous: Option<String>,
    public_key: &str,
) -> String {
    let payload = HostKeyMismatchError {
        code: "host_key_mismatch",
        hostname: hostname.to_string(),
        port,
        fingerprint: fingerprint.to_string(),
        previous_fingerprint: previous,
        public_key: public_key.to_string(),
    };
    serde_json::to_string(&payload).unwrap_or_else(|_| {
        format!(
            r#"{{"code":"host_key_mismatch","hostname":"{hostname}","port":{port},"fingerprint":"{fingerprint}"}}"#
        )
    })
}

// ── Host-key handler ────────────────────────────────────────────────────────

/// Decision shared between the connect task and the russh handler.
struct HostKeyGate {
    /// Precomputed pin for this host:port (OpenSSH public key line), if any.
    trusted: Option<KnownHostEntry>,
    /// Result of the first `check_server_key` call.
    outcome: std::sync::Mutex<Option<HostKeyGateOutcome>>,
}

struct HostKeyGateOutcome {
    decision: HostKeyDecision,
    /// OpenSSH public key line of the server key we saw.
    server_public_key: String,
    fingerprint: String,
}

struct SshHandler {
    gate: Arc<HostKeyGate>,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key
            .fingerprint(HashAlg::Sha256)
            .to_string();
        let server_line = server_public_key.to_openssh().map_err(|e| {
            // Map encode failure into a russh error so the handshake aborts cleanly.
            russh::Error::InvalidConfig(format!("encode server public key: {e}"))
        })?;

        let decision = tofu_check_strings(
            &server_line,
            &fingerprint,
            self.gate.trusted.as_ref(),
        );

        let allow = matches!(
            decision,
            HostKeyDecision::TrustOnFirstUse { .. } | HostKeyDecision::Matched
        );

        if let Ok(mut g) = self.gate.outcome.lock() {
            *g = Some(HostKeyGateOutcome {
                decision,
                server_public_key: server_line,
                fingerprint,
            });
        }
        Ok(allow)
    }
}

// ── Session state ───────────────────────────────────────────────────────────

struct SshSession {
    host_id: String,
    /// Retained for SFTP / reconnect diagnostics (PR6+).
    #[allow(dead_code)]
    hostname: String,
    #[allow(dead_code)]
    port: u16,
    alive: Arc<AtomicBool>,
    generation: u64,
    /// Channel write half for stdin + window_change.
    writer: AsyncMutex<Option<ChannelWriteHalf<client::Msg>>>,
    /// Keep the client handle so disconnect works.
    handle: AsyncMutex<Option<Handle<SshHandler>>>,
}

pub struct SshManager {
    sessions: std::sync::Mutex<HashMap<String, Arc<SshSession>>>,
    next_generation: AtomicU64,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: std::sync::Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        }
    }

    fn next_gen(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::SeqCst)
    }

    pub fn list_ids(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }

    pub fn list_alive_ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, s)| s.alive.load(Ordering::SeqCst))
            .map(|(k, _)| k.clone())
            .collect()
    }

    pub fn kill_all(&self, budget: &TerminalBudget) {
        let mut map = self.sessions.lock().unwrap();
        let ids: Vec<String> = map.keys().cloned().collect();
        for id in ids {
            if let Some(sess) = map.remove(&id) {
                sess.alive.store(false, Ordering::SeqCst);
                budget.release(&id);
                // Best-effort async cleanup is fire-and-forget.
                let s = Arc::clone(&sess);
                tauri::async_runtime::spawn(async move {
                    close_session_handles(&s).await;
                });
            }
        }
    }
}

impl Default for SshManager {
    fn default() -> Self {
        Self::new()
    }
}

async fn close_session_handles(sess: &SshSession) {
    sess.alive.store(false, Ordering::SeqCst);
    if let Some(w) = sess.writer.lock().await.take() {
        let _ = w.close().await;
    }
    if let Some(handle) = sess.handle.lock().await.take() {
        let _ = handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
    }
}

// ── Drop-oldest emit queue (same spirit as pty) ─────────────────────────────

struct EmitQueue {
    chunks: std::collections::VecDeque<Vec<u8>>,
    bytes: usize,
}

impl EmitQueue {
    fn new() -> Self {
        Self {
            chunks: std::collections::VecDeque::new(),
            bytes: 0,
        }
    }

    fn push(&mut self, chunk: Vec<u8>) {
        self.bytes += chunk.len();
        self.chunks.push_back(chunk);
        while self.chunks.len() > MAX_QUEUE_CHUNKS || self.bytes > MAX_QUEUE_BYTES {
            if let Some(dropped) = self.chunks.pop_front() {
                self.bytes = self.bytes.saturating_sub(dropped.len());
            } else {
                break;
            }
        }
    }

    fn pop_all(&mut self) -> Vec<Vec<u8>> {
        self.bytes = 0;
        self.chunks.drain(..).collect()
    }
}

fn split_chunks(data: &[u8], max: usize) -> Vec<Vec<u8>> {
    if data.is_empty() {
        return Vec::new();
    }
    data.chunks(max).map(|c| c.to_vec()).collect()
}

// ── Open helpers ────────────────────────────────────────────────────────────

fn load_host_meta(app: &AppHandle, host_id: &str) -> Result<TerminalHost, String> {
    let path =
        crate::paths::terminal_hosts_path(app).ok_or_else(|| "no config dir".to_string())?;
    let catalog = load_catalog(&path);
    catalog
        .hosts
        .into_iter()
        .find(|h| h.id == host_id)
        .ok_or_else(|| format!("host not found: {host_id}"))
}

fn secret_password_key(host_id: &str) -> String {
    format!("hip.ssh.{host_id}.password")
}

fn secret_passphrase_key(host_id: &str) -> String {
    format!("hip.ssh.{host_id}.passphrase")
}

/// Pin TOFU key after successful first-use connect.
fn pin_tofu_if_needed(
    app: &AppHandle,
    hostname: &str,
    port: u16,
    outcome: &HostKeyGateOutcome,
) -> Result<(), String> {
    if !matches!(
        outcome.decision,
        HostKeyDecision::TrustOnFirstUse { .. }
    ) {
        return Ok(());
    }
    let path = crate::ssh_known_hosts::known_hosts_path(app)
        .ok_or_else(|| "no config dir".to_string())?;
    let mut file = load_known_hosts(&path);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    trust_host(
        &mut file,
        hostname,
        port,
        outcome.server_public_key.clone(),
        outcome.fingerprint.clone(),
        now,
    );
    save_known_hosts(&path, &file).map_err(|e| e.to_string())?;
    eprintln!(
        "[ssh] tofu_trust host={} pin={}",
        host_key_id(hostname, port),
        outcome.fingerprint
    );
    Ok(())
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_open(
    app: AppHandle,
    manager: State<'_, SshManager>,
    budget: State<'_, TerminalBudget>,
    terminal_id: String,
    host_id: String,
    cols: u16,
    rows: u16,
) -> Result<SshOpenResult, String> {
    if terminal_id.is_empty() {
        return Err("terminalId is empty".into());
    }
    if !terminal_id.starts_with("tm_") {
        return Err("ssh_open requires managed terminal id (tm_*)".into());
    }
    let cols = cols.max(2) as u32;
    let rows = rows.max(1) as u32;

    // Reuse alive session: resize only. (Drop std MutexGuard before any .await.)
    let reuse: Option<(u64, Arc<SshSession>)> = {
        let map = manager.sessions.lock().unwrap();
        map.get(&terminal_id).and_then(|sess| {
            if sess.alive.load(Ordering::SeqCst) && sess.host_id == host_id {
                Some((sess.generation, Arc::clone(sess)))
            } else {
                None
            }
        })
    };
    if let Some((gen, sess)) = reuse {
        if let Some(w) = sess.writer.lock().await.as_ref() {
            let _ = w.window_change(cols, rows, 0, 0).await;
        }
        return Ok(SshOpenResult {
            reused: true,
            generation: gen,
        });
    }

    // Tear down any existing entry for this id (different host / dead).
    {
        let mut map = manager.sessions.lock().unwrap();
        if let Some(old) = map.remove(&terminal_id) {
            old.alive.store(false, Ordering::SeqCst);
            budget.release(&terminal_id);
            let old = Arc::clone(&old);
            tauri::async_runtime::spawn(async move {
                close_session_handles(&old).await;
            });
        }
    }

    // Budget acquire — lock order Budget only (session_exists if id was known).
    // We already removed any prior entry; session_exists is false for fresh open.
    // Reopen of a previously known dead id: not in map → false is fine (slot free).
    let newly = budget.try_acquire(&terminal_id, false)?;

    let host = match load_host_meta(&app, &host_id) {
        Ok(h) => h,
        Err(e) => {
            if newly {
                budget.release(&terminal_id);
            }
            return Err(e);
        }
    };

    let result = open_ssh_connection(&app, &manager, &budget, &terminal_id, &host, cols, rows).await;

    match result {
        Ok(r) => {
            eprintln!(
                "[ssh] open hostId={} terminalId={} auth={} ok",
                host_id,
                terminal_id,
                host.auth_method
            );
            Ok(r)
        }
        Err(e) => {
            if newly {
                budget.release(&terminal_id);
            }
            // Avoid logging secrets — e is already redacted.
            eprintln!(
                "[ssh] open hostId={} terminalId={} err={}",
                host_id,
                terminal_id,
                if e.contains("host_key_mismatch") {
                    "host_key_mismatch"
                } else if e.contains("Authentication") || e.contains("auth") {
                    "auth_failed"
                } else {
                    "failed"
                }
            );
            Err(e)
        }
    }
}

async fn open_ssh_connection(
    app: &AppHandle,
    manager: &SshManager,
    _budget: &TerminalBudget,
    terminal_id: &str,
    host: &TerminalHost,
    cols: u32,
    rows: u32,
) -> Result<SshOpenResult, String> {
    let hostname = host.hostname.trim().to_string();
    if hostname.is_empty() {
        return Err("hostname is empty".into());
    }
    let port = if host.port == 0 { 22 } else { host.port };
    let username = host.username.trim().to_string();
    if username.is_empty() {
        return Err("username is empty".into());
    }

    // Load known pin for TOFU.
    let kh_path = crate::ssh_known_hosts::known_hosts_path(app)
        .ok_or_else(|| "no config dir".to_string())?;
    let kh = load_known_hosts(&kh_path);
    let trusted = get_pin(&kh, &hostname, port).cloned();

    let gate = Arc::new(HostKeyGate {
        trusted,
        outcome: std::sync::Mutex::new(None),
    });

    let config = client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 5,
        ..Default::default()
    };
    let config = Arc::new(config);
    let handler = SshHandler {
        gate: Arc::clone(&gate),
    };

    let addrs = (hostname.as_str(), port);
    let mut handle = client::connect(config, addrs, handler)
        .await
        .map_err(|e| {
            // If TOFU mismatch caused the reject, surface structured error.
            if let Ok(g) = gate.outcome.lock() {
                if let Some(ref o) = *g {
                    if let HostKeyDecision::Mismatch {
                        fingerprint_sha256,
                        previous_fingerprint_sha256,
                    } = &o.decision
                    {
                        return mismatch_err(
                            &hostname,
                            port,
                            fingerprint_sha256,
                            previous_fingerprint_sha256.clone(),
                            &o.server_public_key,
                        );
                    }
                }
            }
            format!("SSH connect failed: {e}")
        })?;

    // Double-check gate for mismatch (connect may also succeed path with allow=false → err above).
    // Clone outcome fields before any `.await` so MutexGuard is not held across await (Send).
    let mismatch_payload = {
        let g = gate.outcome.lock().ok();
        g.and_then(|guard| {
            guard.as_ref().and_then(|o| match &o.decision {
                HostKeyDecision::Mismatch {
                    fingerprint_sha256,
                    previous_fingerprint_sha256,
                } => Some((
                    fingerprint_sha256.clone(),
                    previous_fingerprint_sha256.clone(),
                    o.server_public_key.clone(),
                )),
                _ => None,
            })
        })
    };
    if let Some((fp, prev, pubkey)) = mismatch_payload {
        let _ = handle
            .disconnect(Disconnect::ByApplication, "host key mismatch", "en")
            .await;
        return Err(mismatch_err(&hostname, port, &fp, prev, &pubkey));
    }

    // Auth — load secrets only here.
    let auth_method = host.auth_method.as_str();
    match auth_method {
        "password" => {
            let password = crate::get_secret_value(app, &secret_password_key(&host.id))
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "SSH password not configured for this host".to_string())?;
            let auth_res = handle
                .authenticate_password(&username, password)
                .await
                .map_err(|e| format!("SSH password auth error: {e}"))?;
            if !auth_res.success() {
                return Err("SSH authentication failed (password)".into());
            }
        }
        "privateKey" => {
            let key_path_raw = host
                .private_key_path
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "private key path not configured".to_string())?;
            let key_path = expand_tilde_path(key_path_raw)?;
            if !key_path.is_file() {
                return Err(format!(
                    "private key not found: {}",
                    key_path.display()
                ));
            }
            let passphrase = crate::get_secret_value(app, &secret_passphrase_key(&host.id))
                .filter(|s| !s.is_empty());
            let key = keys::load_secret_key(&key_path, passphrase.as_deref()).map_err(|e| {
                // Do not include passphrase in error.
                format!("failed to load private key: {e}")
            })?;
            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("SSH key negotiation error: {e}"))?
                .flatten();
            let auth_res = handle
                .authenticate_publickey(
                    &username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|e| format!("SSH publickey auth error: {e}"))?;
            if !auth_res.success() {
                return Err("SSH authentication failed (public key)".into());
            }
        }
        other => {
            return Err(format!(
                "unsupported SSH auth method: {other} (v1 supports password | privateKey)"
            ));
        }
    }

    // Pin on first use after successful auth.
    if let Ok(g) = gate.outcome.lock() {
        if let Some(ref o) = *g {
            let _ = pin_tofu_if_needed(app, &hostname, port, o);
        }
    }

    // Interactive shell channel.
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("SSH channel open failed: {e}"))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("SSH request_pty failed: {e}"))?;
    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("SSH request_shell failed: {e}"))?;

    let (mut read_half, write_half) = channel.split();
    let generation = manager.next_gen();
    let alive = Arc::new(AtomicBool::new(true));

    let sess = Arc::new(SshSession {
        host_id: host.id.clone(),
        hostname: hostname.clone(),
        port,
        alive: Arc::clone(&alive),
        generation,
        writer: AsyncMutex::new(Some(write_half)),
        handle: AsyncMutex::new(Some(handle)),
    });

    {
        let mut map = manager.sessions.lock().unwrap();
        // Soft re-check (race with concurrent opens).
        let alive_n = map
            .values()
            .filter(|s| s.alive.load(Ordering::SeqCst))
            .count();
        // Budget already holds our slot; just insert.
        let _ = alive_n;
        if let Some(displaced) = map.insert(terminal_id.to_string(), Arc::clone(&sess)) {
            displaced.alive.store(false, Ordering::SeqCst);
            let d = Arc::clone(&displaced);
            tauri::async_runtime::spawn(async move {
                close_session_handles(&d).await;
            });
        }
    }

    // Reader + coalesce loop.
    let emit_app = app.clone();
    let emit_id = terminal_id.to_string();
    let emit_alive = Arc::clone(&alive);
    let emit_gen = generation;
    let emit_budget_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut pending: Vec<u8> = Vec::new();
        let mut queue = EmitQueue::new();
        let mut last_activity = Instant::now();
        let mut exit_code: Option<i32> = None;

        loop {
            if !emit_alive.load(Ordering::SeqCst) {
                break;
            }

            let wait = read_half.wait();
            let timeout = tokio::time::timeout(Duration::from_millis(COALESCE_MS), wait);

            match timeout.await {
                Ok(Some(msg)) => match msg {
                    ChannelMsg::Data { ref data } => {
                        pending.extend_from_slice(data);
                        last_activity = Instant::now();
                        if pending.len() >= COALESCE_BYTES {
                            flush_ssh_pending(&emit_app, &emit_id, &mut pending, &mut queue);
                        }
                    }
                    ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                        // stderr
                        pending.extend_from_slice(data);
                        last_activity = Instant::now();
                        if pending.len() >= COALESCE_BYTES {
                            flush_ssh_pending(&emit_app, &emit_id, &mut pending, &mut queue);
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => {
                        exit_code = Some(exit_status as i32);
                    }
                    ChannelMsg::Eof | ChannelMsg::Close => {
                        break;
                    }
                    _ => {}
                },
                Ok(None) => break,
                Err(_) => {
                    // timeout — flush if time path
                    if !pending.is_empty()
                        && last_activity.elapsed() >= Duration::from_millis(COALESCE_MS)
                    {
                        flush_ssh_pending(&emit_app, &emit_id, &mut pending, &mut queue);
                    }
                }
            }
        }

        flush_ssh_pending(&emit_app, &emit_id, &mut pending, &mut queue);
        emit_alive.store(false, Ordering::SeqCst);

        // Release budget slot.
        if let Some(budget) = emit_budget_app.try_state::<TerminalBudget>() {
            budget.release(&emit_id);
        }

        let _ = emit_app.emit(
            "ssh:exit",
            SshExitEvent {
                terminal_id: emit_id,
                code: exit_code,
                generation: emit_gen,
                message: None,
            },
        );
    });

    Ok(SshOpenResult {
        reused: false,
        generation,
    })
}

fn flush_ssh_pending(
    app: &AppHandle,
    terminal_id: &str,
    pending: &mut Vec<u8>,
    queue: &mut EmitQueue,
) {
    if pending.is_empty() {
        return;
    }
    let data = std::mem::take(pending);
    for chunk in split_chunks(&data, MAX_EMIT_RAW) {
        queue.push(chunk);
    }
    for chunk in queue.pop_all() {
        let payload = SshDataEvent {
            terminal_id: terminal_id.to_string(),
            data: B64.encode(&chunk),
        };
        let _ = app.emit("ssh:data", payload);
    }
}

#[tauri::command]
pub async fn ssh_write(
    manager: State<'_, SshManager>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let sess = {
        let map = manager.sessions.lock().unwrap();
        map.get(&terminal_id)
            .cloned()
            .ok_or_else(|| format!("no ssh session for {terminal_id}"))?
    };
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(format!("ssh session {terminal_id} has exited"));
    }
    let guard = sess.writer.lock().await;
    let writer = guard
        .as_ref()
        .ok_or_else(|| format!("no writer for ssh session {terminal_id}"))?;
    // channel.data takes AsyncRead — use bytes as slice reader.
    let bytes = data.into_bytes();
    writer
        .data(&bytes[..])
        .await
        .map_err(|e| format!("ssh write failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    manager: State<'_, SshManager>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cols = cols.max(2) as u32;
    let rows = rows.max(1) as u32;
    let sess = {
        let map = manager.sessions.lock().unwrap();
        map.get(&terminal_id)
            .cloned()
            .ok_or_else(|| format!("no ssh session for {terminal_id}"))?
    };
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(format!("ssh session {terminal_id} has exited"));
    }
    let guard = sess.writer.lock().await;
    let writer = guard
        .as_ref()
        .ok_or_else(|| format!("no writer for ssh session {terminal_id}"))?;
    writer
        .window_change(cols, rows, 0, 0)
        .await
        .map_err(|e| format!("ssh resize failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_close(
    manager: State<'_, SshManager>,
    budget: State<'_, TerminalBudget>,
    terminal_id: String,
) -> Result<(), String> {
    let sess = {
        let mut map = manager.sessions.lock().unwrap();
        map.remove(&terminal_id)
    };
    if let Some(sess) = sess {
        sess.alive.store(false, Ordering::SeqCst);
        budget.release(&terminal_id);
        close_session_handles(&sess).await;
    } else {
        budget.release(&terminal_id);
    }
    Ok(())
}

#[tauri::command]
pub fn ssh_list(manager: State<'_, SshManager>) -> Result<Vec<String>, String> {
    Ok(manager.list_ids())
}

// Silence unused import if MAX is only used via budget module.
#[allow(dead_code)]
const _MAX_CHECK: usize = MAX_INTERACTIVE_TERMINALS;
