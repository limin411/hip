//! Production SSH interactive shell via `russh` (Cargo feature `ssh`).
//!
//! Commands: ssh_open / ssh_write / ssh_resize / ssh_close / ssh_list.
//! Events: `ssh:data` (base64) / `ssh:exit` (generation required).
//! Secrets loaded only in Rust via `get_secret_value` — never exposed to renderer.

#![cfg(feature = "ssh")]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

use russh::client::{self, Handle};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelMsg, ChannelWriteHalf, Disconnect};

use crate::ssh_known_hosts::{
    get_pin, host_key_id, tofu_check_strings, trust_host, with_known_hosts, with_known_hosts_mut,
    HostKeyDecision, KnownHostEntry,
};
use crate::ssh_path::expand_tilde_path;
use crate::terminal_budget::{TerminalBudget, MAX_INTERACTIVE_TERMINALS};
use crate::terminal_hosts::{load_catalog, BastionConfig, TerminalHost};

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
    // Always JSON via serde (no hand-interpolated fallback — Issue 13).
    serde_json::to_string(&payload).unwrap_or_else(|_| {
        r#"{"code":"host_key_mismatch","hostname":"","port":0,"fingerprint":"","publicKey":""}"#
            .to_string()
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

pub(crate) struct SshSession {
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
    /// Keep the client handle so disconnect works + lazy SFTP channel open.
    handle: AsyncMutex<Option<Handle<SshHandler>>>,
    /// Long-lived SFTP subsystem co-owned with the shell (PR6); opened lazily.
    sftp: AsyncMutex<Option<Arc<russh_sftp::client::SftpSession>>>,
}

pub struct SshManager {
    sessions: std::sync::Mutex<HashMap<String, Arc<SshSession>>>,
    /// In-flight `ssh_open` ids — single-flight so concurrent same-id opens
    /// cannot free each other's budget reservation (Issue 4).
    opening: std::sync::Mutex<HashSet<String>>,
    next_generation: AtomicU64,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: std::sync::Mutex::new(HashMap::new()),
            opening: std::sync::Mutex::new(HashSet::new()),
            next_generation: AtomicU64::new(1),
        }
    }

    fn next_gen(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::SeqCst)
    }

    /// Begin single-flight open for `id`. Err if another open is already in progress.
    fn begin_open(&self, id: &str) -> Result<(), String> {
        let mut set = self.opening.lock().unwrap();
        if !set.insert(id.to_string()) {
            return Err("SSH open already in progress for this terminal".into());
        }
        Ok(())
    }

    fn end_open(&self, id: &str) {
        self.opening.lock().unwrap().remove(id);
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
    // Drop SFTP before shell/TCP so in-flight transfers fail cleanly.
    if let Some(sftp) = sess.sftp.lock().await.take() {
        let _ = sftp.close().await;
    }
    if let Some(w) = sess.writer.lock().await.take() {
        let _ = w.close().await;
    }
    if let Some(handle) = sess.handle.lock().await.take() {
        let _ = handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
    }
}

/// Session closed / missing error string (SFTP + write/resize).
pub const SESSION_CLOSED: &str = "SSH session is closed";

/// Return an alive session for SFTP / diagnostics. Err if missing or dead.
pub fn get_alive_session(
    manager: &SshManager,
    terminal_id: &str,
) -> Result<Arc<SshSession>, String> {
    let map = manager.sessions.lock().unwrap();
    let sess = map
        .get(terminal_id)
        .cloned()
        .ok_or_else(|| SESSION_CLOSED.to_string())?;
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(SESSION_CLOSED.to_string());
    }
    Ok(sess)
}

/// Lazily open (or reuse) the SFTP subsystem channel on an alive SSH session.
pub async fn ensure_sftp(sess: &SshSession) -> Result<Arc<russh_sftp::client::SftpSession>, String> {
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(SESSION_CLOSED.to_string());
    }
    // Double-checked under sftp mutex so concurrent first ops open once.
    {
        let guard = sess.sftp.lock().await;
        if let Some(ref s) = *guard {
            return Ok(Arc::clone(s));
        }
    }
    let mut guard = sess.sftp.lock().await;
    if let Some(ref s) = *guard {
        return Ok(Arc::clone(s));
    }
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(SESSION_CLOSED.to_string());
    }

    let channel = {
        let handle_guard = sess.handle.lock().await;
        let handle = handle_guard
            .as_ref()
            .ok_or_else(|| SESSION_CLOSED.to_string())?;
        handle
            .channel_open_session()
            .await
            .map_err(|e| format!("SFTP channel open failed: {e}"))?
    };

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("SFTP subsystem request failed: {e}"))?;

    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP init failed: {e}"))?;
    let arc = Arc::new(sftp);
    *guard = Some(Arc::clone(&arc));
    Ok(arc)
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

/// Load an OpenSSH/PKCS8 private key, tolerant of Windows text quirks.
///
/// Strips a UTF-8 BOM and normalizes CRLF so `-----BEGIN …-----` line matches
/// succeed (russh matches BEGIN markers with exact equality on each line).
fn load_private_key_file(
    path: &std::path::Path,
    passphrase: Option<&str>,
) -> Result<keys::PrivateKey, String> {
    let raw = std::fs::read(path).map_err(|e| format!("failed to read private key: {e}"))?;
    let text = String::from_utf8_lossy(&raw);
    let normalized = text
        .strip_prefix('\u{feff}')
        .unwrap_or(text.as_ref())
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    keys::decode_secret_key(&normalized, passphrase).map_err(|e| {
        // Do not include passphrase in error.
        format!("failed to load private key: {e}")
    })
}

/// Pin TOFU key after successful first-use connect (serialized RMW).
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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    with_known_hosts_mut(&path, |file| {
        trust_host(
            file,
            hostname,
            port,
            outcome.server_public_key.clone(),
            outcome.fingerprint.clone(),
            now,
        );
        Ok(())
    })?;
    eprintln!(
        "[ssh] tofu_trust host={} pin={}",
        host_key_id(hostname, port),
        outcome.fingerprint
    );
    Ok(())
}

/// Authenticate an SSH connection using the host's credentials.
async fn authenticate_ssh_connection(
    app: &AppHandle,
    handle: &mut Handle<SshHandler>,
    host: &TerminalHost,
) -> Result<(), String> {
    let username = host.username.trim();
    let auth_method = host.auth_method.as_str();
    
    match auth_method {
        "password" => {
            let password = crate::get_secret_value(app, &secret_password_key(&host.id))
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("SSH password not configured for host {}", host.label))?;
            let auth_res = handle
                .authenticate_password(username, password)
                .await
                .map_err(|e| format!("SSH password auth error for {}: {e}", host.label))?;
            if !auth_res.success() {
                return Err(format!("SSH authentication failed (password) for host {}", host.label));
            }
        }
        "privateKey" => {
            let key_path_raw = host
                .private_key_path
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| format!("private key path not configured for host {}", host.label))?;
            let key_path = expand_tilde_path(key_path_raw)?;
            if !key_path.is_file() {
                return Err(format!(
                    "private key not found for host {}: {}",
                    host.label,
                    key_path.display()
                ));
            }
            let passphrase = crate::get_secret_value(app, &secret_passphrase_key(&host.id))
                .filter(|s| !s.is_empty());
            let key = load_private_key_file(&key_path, passphrase.as_deref())?;
            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|e| format!("SSH key negotiation error: {e}"))?
                .flatten();
            let auth_res = handle
                .authenticate_publickey(
                    username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|e| format!("SSH publickey auth error for {}: {e}", host.label))?;
            if !auth_res.success() {
                return Err(format!("SSH authentication failed (public key) for host {}", host.label));
            }
        }
        other => {
            return Err(format!(
                "unsupported SSH auth method for host {}: {other} (supports password | privateKey)",
                host.label
            ));
        }
    }
    Ok(())
}

/// Connect to a target host through a bastion (jump host).
/// Single-hop only: bastion cannot have its own bastion.
async fn connect_through_bastion(
    app: &AppHandle,
    manager: &SshManager,
    terminal_id: &str,
    target_host: &TerminalHost,
    bastion_config: &BastionConfig,
    cols: u32,
    rows: u32,
) -> Result<SshOpenResult, String> {
    eprintln!(
        "[ssh] connecting through bastion: target={} bastion={}",
        target_host.id, bastion_config.host_id
    );

    // 1. Load bastion host configuration
    let bastion_host = load_host_meta(app, &bastion_config.host_id)?;
    
    // Apply overrides from bastion config
    let mut bastion_host = bastion_host;
    if let Some(username) = &bastion_config.username {
        bastion_host.username = username.clone();
    }
    if let Some(port) = bastion_config.port {
        bastion_host.port = port;
    }

    // 2. Connect to bastion (direct connection, no nesting)
    let bastion_hostname = bastion_host.hostname.trim().to_string();
    if bastion_hostname.is_empty() {
        return Err("bastion hostname is empty".into());
    }
    let bastion_port = if bastion_host.port == 0 { 22 } else { bastion_host.port };

    // Load known pin for TOFU
    let kh_path = crate::ssh_known_hosts::known_hosts_path(app)
        .ok_or_else(|| "no config dir".to_string())?;
    let bastion_trusted = with_known_hosts(&kh_path, |kh| {
        get_pin(kh, &bastion_hostname, bastion_port).cloned()
    })?;

    let bastion_gate = Arc::new(HostKeyGate {
        trusted: bastion_trusted,
        outcome: std::sync::Mutex::new(None),
    });

    let config = client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 5,
        ..Default::default()
    };

    let handler = SshHandler {
        gate: Arc::clone(&bastion_gate),
    };

    eprintln!(
        "[ssh] connecting to bastion {}:{}",
        bastion_hostname, bastion_port
    );

    let mut bastion_handle = client::connect(Arc::new(config), (bastion_hostname.as_str(), bastion_port), handler)
        .await
        .map_err(|e| {
            // Check for TOFU mismatch
            if let Ok(g) = bastion_gate.outcome.lock() {
                if let Some(ref o) = *g {
                    if let HostKeyDecision::Mismatch {
                        fingerprint_sha256,
                        previous_fingerprint_sha256,
                    } = &o.decision
                    {
                        return format!(
                            "Bastion host key mismatch for {}: {}",
                            bastion_host.label,
                            mismatch_err(&bastion_hostname, bastion_port, fingerprint_sha256, previous_fingerprint_sha256.clone(), &o.server_public_key)
                        );
                    }
                }
            }
            format!("Failed to connect to bastion {}: {e}", bastion_host.label)
        })?;

    // Authenticate bastion
    authenticate_ssh_connection(app, &mut bastion_handle, &bastion_host).await
        .map_err(|e| format!("Bastion authentication failed: {e}"))?;

    // Pin TOFU if needed
    if let Ok(g) = bastion_gate.outcome.lock() {
        if let Some(ref o) = *g {
            if let Err(e) = pin_tofu_if_needed(app, &bastion_hostname, bastion_port, o) {
                eprintln!("[ssh] tofu pin failed bastion={}: {e}", host_key_id(&bastion_hostname, bastion_port));
            }
        }
    }

    eprintln!("[ssh] bastion connected, opening tunnel to {}:{}", target_host.hostname, target_host.port);

    // 3. Open tunnel channel through bastion to target
    let target_port = if target_host.port == 0 { 22 } else { target_host.port };
    let tunnel_channel = bastion_handle
        .channel_open_direct_tcpip(
            &target_host.hostname,
            target_port as u32,
            "127.0.0.1",
            0,
        )
        .await
        .map_err(|e| format!("Failed to open tunnel through bastion to {}:{}: {e}", target_host.hostname, target_port))?;

    // 4. Convert channel to stream for new SSH connection
    let stream = tunnel_channel.into_stream();

    // 5. Connect to target through tunnel
    let target_gate = Arc::new(HostKeyGate {
        trusted: None, // Target is behind bastion, skip TOFU
        outcome: std::sync::Mutex::new(None),
    });

    let target_handler = SshHandler {
        gate: Arc::clone(&target_gate),
    };

    let target_config = client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 5,
        ..Default::default()
    };

    eprintln!(
        "[ssh] connecting to target {} through tunnel",
        target_host.hostname
    );

    let mut target_handle = client::connect_stream(Arc::new(target_config), stream, target_handler)
        .await
        .map_err(|e| format!("Failed to connect to target {} through tunnel: {e}", target_host.hostname))?;

    // 6. Authenticate to target
    authenticate_ssh_connection(app, &mut target_handle, target_host).await
        .map_err(|e| format!("Target authentication failed: {e}"))?;

    eprintln!("[ssh] target connected, opening shell");

    // 7. Open shell channel on target
    let channel = target_handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open shell channel on target: {e}"))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("Failed to request PTY on target: {e}"))?;
    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Failed to request shell on target: {e}"))?;

    let (mut read_half, write_half) = channel.split();
    let generation = manager.next_gen();
    let alive = Arc::new(AtomicBool::new(true));

    let sess = Arc::new(SshSession {
        host_id: target_host.id.clone(),
        hostname: target_host.hostname.clone(),
        port: target_port,
        alive: Arc::clone(&alive),
        generation,
        writer: AsyncMutex::new(Some(write_half)),
        handle: AsyncMutex::new(Some(target_handle)),
        sftp: AsyncMutex::new(None),
    });

    {
        let mut map = manager.sessions.lock().unwrap();
        if let Some(displaced) = map.insert(terminal_id.to_string(), Arc::clone(&sess)) {
            displaced.alive.store(false, Ordering::SeqCst);
            let d = Arc::clone(&displaced);
            tauri::async_runtime::spawn(async move {
                close_session_handles(&d).await;
            });
        }
    }

    // Spawn reader loop (same as direct connection)
    let emit_app = app.clone();
    let emit_id = terminal_id.to_string();
    let emit_alive = Arc::clone(&alive);
    let emit_gen = generation;
    let emit_budget_app = app.clone();
    let emit_sess = Arc::clone(&sess);
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
                    if !pending.is_empty()
                        && last_activity.elapsed() >= Duration::from_millis(COALESCE_MS)
                    {
                        flush_ssh_pending(&emit_app, &emit_id, &mut pending, &mut queue);
                    }
                }
            }
        }

        flush_ssh_pending(&emit_app, &emit_id, &mut pending, &mut queue);
        close_session_handles(&emit_sess).await;
        emit_alive.store(false, Ordering::SeqCst);

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

    // Single-flight: concurrent same-id opens must not race budget release (Issue 4).
    manager.begin_open(&terminal_id)?;

    // Tear down any existing entry for this id (different host / dead).
    // Remember membership so soft_cap_allows can reopen existing ids at cap (Issue 11).
    let session_existed = {
        let mut map = manager.sessions.lock().unwrap();
        let existed = map.contains_key(&terminal_id);
        if let Some(old) = map.remove(&terminal_id) {
            old.alive.store(false, Ordering::SeqCst);
            budget.release(&terminal_id);
            let old = Arc::clone(&old);
            tauri::async_runtime::spawn(async move {
                close_session_handles(&old).await;
            });
        }
        existed
    };

    // Budget acquire after manager teardown; budget mutex is not held across I/O.
    let newly = match budget.try_acquire(&terminal_id, session_existed) {
        Ok(n) => n,
        Err(e) => {
            manager.end_open(&terminal_id);
            return Err(e);
        }
    };

    let host = match load_host_meta(&app, &host_id) {
        Ok(h) => h,
        Err(e) => {
            if newly {
                budget.release(&terminal_id);
            }
            manager.end_open(&terminal_id);
            return Err(e);
        }
    };

    let result =
        open_ssh_connection(&app, &manager, &budget, &terminal_id, &host, cols, rows).await;

    // On fail: release budget *before* end_open so a second same-id open cannot
    // observe our reservation then lose it when we release (Issue 4 residual).
    // Success path: slot stays held; end_open only drops the single-flight guard.
    if result.is_err() {
        let published_alive = {
            let map = manager.sessions.lock().unwrap();
            map.get(&terminal_id)
                .map(|s| s.alive.load(Ordering::SeqCst))
                .unwrap_or(false)
        };
        if newly && !published_alive {
            budget.release(&terminal_id);
        }
    }
    manager.end_open(&terminal_id);

    match result {
        Ok(r) => {
            eprintln!(
                "[ssh] open hostId={} terminalId={} auth={} ok",
                host_id, terminal_id, host.auth_method
            );
            Ok(r)
        }
        Err(e) => {
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
    // If bastion is configured, use bastion connection
    if let Some(bastion_config) = &host.bastion {
        return connect_through_bastion(app, manager, terminal_id, host, bastion_config, cols, rows).await;
    }

    // Direct connection (existing logic)
    let hostname = host.hostname.trim().to_string();
    if hostname.is_empty() {
        return Err("hostname is empty".into());
    }
    let port = if host.port == 0 { 22 } else { host.port };
    let username = host.username.trim().to_string();
    if username.is_empty() {
        return Err("username is empty".into());
    }

    // Load known pin for TOFU (under known_hosts lock).
    let kh_path = crate::ssh_known_hosts::known_hosts_path(app)
        .ok_or_else(|| "no config dir".to_string())?;
    let trusted = with_known_hosts(&kh_path, |kh| get_pin(kh, &hostname, port).cloned())?;

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
            // Read + decode ourselves so Windows CRLF / UTF-8 BOM keys still parse
            // (russh `load_secret_key` matches BEGIN lines with exact equality).
            let key = load_private_key_file(&key_path, passphrase.as_deref())?;
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

    // Pin on first use after successful auth (log pin failures — Issue 9).
    if let Ok(g) = gate.outcome.lock() {
        if let Some(ref o) = *g {
            if let Err(e) = pin_tofu_if_needed(app, &hostname, port, o) {
                eprintln!(
                    "[ssh] tofu pin failed host={}: {e}",
                    host_key_id(&hostname, port)
                );
            }
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
        sftp: AsyncMutex::new(None),
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

    // Reader + coalesce loop. On exit: drop network handles (Issue 3) then budget + event.
    let emit_app = app.clone();
    let emit_id = terminal_id.to_string();
    let emit_alive = Arc::clone(&alive);
    let emit_gen = generation;
    let emit_budget_app = app.clone();
    let emit_sess = Arc::clone(&sess);
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
        // Drop channel writer + disconnect TCP (keep map entry for Restart, like PTY).
        close_session_handles(&emit_sess).await;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // Unencrypted OpenSSH ed25519 fixture (same as ssh_spike size probe).
    const OPENSSH_ED25519: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n\
QyNTUxOQAAACBiokB8lBPXaGEXVkH9v1rrviDBWGvRJIcrEU8b2c21sAAAAJB5NdCqeTXQ\n\
qgAAAAtzc2gtZWQyNTUxOQAAACBiokB8lBPXaGEXVkH9v1rrviDBWGvRJIcrEU8b2c21sA\n\
AAAEAiHKsrDB1m0zH9AuSSfT6+zH7bgUmYYCLK4d01XZqczGKiQHyUE9doYRdWQf2/Wuu+\n\
IMFYa9EkhysRTxvZzbWwAAAACWhpcC1zcGlrZQECAwQ=\n\
-----END OPENSSH PRIVATE KEY-----\n";

    #[test]
    fn load_private_key_tolerates_bom_and_crlf() {
        let dir = std::env::temp_dir().join(format!(
            "hip-ssh-key-test-{}-{}",
            std::process::id(),
            "bom-crlf"
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("id_ed25519");
        let crlf: String = OPENSSH_ED25519.replace('\n', "\r\n");
        let mut body = Vec::from("\u{feff}".as_bytes());
        body.extend_from_slice(crlf.as_bytes());
        {
            let mut f = std::fs::File::create(&path).unwrap();
            f.write_all(&body).unwrap();
        }
        let key = load_private_key_file(&path, None).expect("decode bom+crlf key");
        let _ = key.public_key();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
