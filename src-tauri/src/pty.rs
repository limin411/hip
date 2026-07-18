//! Interactive PTY manager for the code-surface Terminal tab.
//!
//! - 1 PTY per sessionId; soft cap 8
//! - Shell preference from `[terminal].shell` in hip.toml (General Settings)
//! - Unix default: `$SHELL -il`; Windows default: `cmd.exe`
//! - Events: `pty:data` (base64) / `pty:exit`
//! - Coalesced reader (8–16 ms / 32 KiB); drop-oldest under backpressure
//! - Windows via ConPTY (`portable-pty`); PowerShell loads user profile

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

use crate::hip_config::TomlHipConfig;
use crate::paths;

/// Max concurrent PTY sessions (D16).
pub const MAX_PTY_SESSIONS: usize = 8;

/// Master read size (design: 8–64 KiB; pick 16 KiB).
const READ_BUF: usize = 16 * 1024;

/// Flush pending when accumulated raw bytes reach this (design: 32 KiB).
const COALESCE_BYTES: usize = 32 * 1024;

/// Coalesce idle window (design: 8–16 ms).
const COALESCE_MS: u64 = 12;

/// Max raw bytes per `pty:data` event before base64 (~256 KiB encoded).
const MAX_EMIT_RAW: usize = 192 * 1024;

/// Pending emit queue depth (chunks); drop oldest when exceeded.
const MAX_QUEUE_CHUNKS: usize = 64;

/// Pending emit queue bytes; drop oldest when exceeded.
const MAX_QUEUE_BYTES: usize = 1024 * 1024;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/// Validate that `cwd` exists and is a directory. Returns canonical-ish PathBuf.
pub fn validate_cwd(cwd: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(cwd);
    if cwd.is_empty() {
        return Err("cwd is empty".into());
    }
    let meta = std::fs::metadata(&p).map_err(|e| format!("cwd not accessible: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("cwd is not a directory: {}", p.display()));
    }
    Ok(p)
}

/// Soft-cap: allow open if session already has a slot, or **alive** count has room.
pub fn soft_cap_allows(alive_count: usize, session_exists: bool, max: usize) -> bool {
    session_exists || alive_count < max
}

/// Whether coalesce buffer should flush (size or time).
pub fn coalesce_should_flush(pending_len: usize, elapsed: Duration) -> bool {
    if pending_len == 0 {
        return false;
    }
    pending_len >= COALESCE_BYTES || elapsed >= Duration::from_millis(COALESCE_MS)
}

/// Normalize shell preference string (empty / unknown → `"default"`).
pub fn normalize_shell_pref(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "cmd" => "cmd",
        "powershell" => "powershell",
        "pwsh" => "pwsh",
        "bash" => "bash",
        "zsh" => "zsh",
        _ => "default",
    }
}

fn first_existing(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|p| p.is_file())
}

fn which_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            // Allow bare name without extension when PATH entry already includes .exe
            if !name.contains('.') {
                for ext in ["exe", "cmd", "bat"] {
                    let c = dir.join(format!("{name}.{ext}"));
                    if c.is_file() {
                        return Some(c);
                    }
                }
            }
        }
    }
    None
}

/// Resolve shell executable from preference (`default` | `cmd` | `powershell` | `pwsh` | `bash` | `zsh`).
///
/// Platform defaults:
/// - Windows `default` / `cmd` → `cmd.exe`
/// - Unix `default` → `$SHELL`, then `/bin/zsh`, `/bin/bash`
pub fn resolve_shell(pref: &str) -> Result<PathBuf, String> {
    let pref = normalize_shell_pref(pref);

    // Explicit HIP_SHELL override (dogfood / CI).
    if let Ok(override_path) = std::env::var("HIP_SHELL") {
        if !override_path.is_empty() {
            let p = PathBuf::from(&override_path);
            if p.is_file() {
                return Ok(p);
            }
            return Err(format!("HIP_SHELL is not a file: {override_path}"));
        }
    }

    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let cmd = PathBuf::from(format!("{system_root}\\System32\\cmd.exe"));
        let powershell = PathBuf::from(format!(
            "{system_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        ));

        match pref {
            "powershell" => {
                if powershell.is_file() {
                    return Ok(powershell);
                }
                return which_on_path("powershell.exe")
                    .ok_or_else(|| "powershell.exe not found".into());
            }
            "pwsh" => {
                let mut candidates: Vec<PathBuf> = Vec::new();
                if let Some(p) = which_on_path("pwsh.exe") {
                    candidates.push(p);
                }
                if let Some(p) = which_on_path("pwsh") {
                    candidates.push(p);
                }
                if let Ok(pf) = std::env::var("ProgramFiles") {
                    candidates.push(PathBuf::from(format!("{pf}\\PowerShell\\7\\pwsh.exe")));
                    candidates.push(PathBuf::from(format!(
                        "{pf}\\PowerShell\\7-preview\\pwsh.exe"
                    )));
                }
                return first_existing(candidates)
                    .ok_or_else(|| "pwsh.exe not found (install PowerShell 7+)".into());
            }
            "bash" => {
                let mut candidates: Vec<PathBuf> = Vec::new();
                if let Some(p) = which_on_path("bash.exe") {
                    candidates.push(p);
                }
                if let Some(p) = which_on_path("bash") {
                    candidates.push(p);
                }
                if let Ok(pf) = std::env::var("ProgramFiles") {
                    candidates.push(PathBuf::from(format!("{pf}\\Git\\bin\\bash.exe")));
                    candidates.push(PathBuf::from(format!("{pf}\\Git\\usr\\bin\\bash.exe")));
                }
                return first_existing(candidates)
                    .ok_or_else(|| "bash.exe not found (install Git for Windows?)".into());
            }
            "zsh" => {
                return which_on_path("zsh.exe")
                    .or_else(|| which_on_path("zsh"))
                    .ok_or_else(|| "zsh not found on PATH".into());
            }
            // default + cmd → cmd.exe
            _ => {
                if cmd.is_file() {
                    return Ok(cmd);
                }
                return which_on_path("cmd.exe").ok_or_else(|| "cmd.exe not found".into());
            }
        }
    }

    #[cfg(not(windows))]
    {
        match pref {
            "bash" => {
                let mut candidates = vec![
                    PathBuf::from("/bin/bash"),
                    PathBuf::from("/usr/bin/bash"),
                ];
                if let Some(p) = which_on_path("bash") {
                    candidates.push(p);
                }
                return first_existing(candidates).ok_or_else(|| "bash not found".into());
            }
            "zsh" => {
                let mut candidates =
                    vec![PathBuf::from("/bin/zsh"), PathBuf::from("/usr/bin/zsh")];
                if let Some(p) = which_on_path("zsh") {
                    candidates.push(p);
                }
                return first_existing(candidates).ok_or_else(|| "zsh not found".into());
            }
            "cmd" | "powershell" | "pwsh" => {
                // Rare on Unix (e.g. pwsh). Try PATH.
                let names: &[&str] = match pref {
                    "cmd" => &["cmd", "cmd.exe"],
                    "powershell" => &["powershell", "powershell.exe"],
                    _ => &["pwsh", "pwsh.exe"],
                };
                for n in names {
                    if let Some(p) = which_on_path(n) {
                        return Ok(p);
                    }
                }
                return Err(format!("{pref} not found on PATH"));
            }
            _ => {
                // default → $SHELL then zsh/bash
                if let Ok(shell) = std::env::var("SHELL") {
                    if !shell.is_empty() {
                        let p = PathBuf::from(&shell);
                        if p.is_file() {
                            return Ok(p);
                        }
                    }
                }
                return first_existing([PathBuf::from("/bin/zsh"), PathBuf::from("/bin/bash")])
                    .ok_or_else(|| {
                        "no usable shell found ($SHELL, /bin/zsh, /bin/bash)".into()
                    });
            }
        }
    }
}

/// Apply platform-appropriate interactive args + TERM env on `cmd`.
pub fn configure_shell_command(cmd: &mut portable_pty::CommandBuilder, shell: &Path) {
    let name = shell
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if name == "cmd.exe" || name == "cmd" {
        // Interactive session; /K keeps shell open if a startup command is ever added.
        cmd.arg("/K");
    } else if name == "powershell.exe" || name == "powershell" {
        // Load user profile (no -NoProfile). -NoLogo only.
        cmd.arg("-NoLogo");
    } else if name == "pwsh.exe" || name == "pwsh" {
        cmd.arg("-NoLogo");
    } else if name.contains("bash") || name.contains("zsh") || name.contains("sh") {
        // Login + interactive (Unix shells / Git Bash).
        cmd.arg("-il");
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
}

/// Read `[terminal].shell` from hip.toml; defaults to `"default"`.
pub fn load_shell_pref(app: &AppHandle) -> String {
    let Some(path) = paths::hip_config_path(app) else {
        return "default".into();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return "default".into();
    };
    let Ok(toml_cfg) = toml::from_str::<TomlHipConfig>(&raw) else {
        return "default".into();
    };
    toml_cfg
        .terminal
        .and_then(|t| t.shell)
        .filter(|s| !s.trim().is_empty())
        .map(|s| normalize_shell_pref(&s).to_string())
        .unwrap_or_else(|| "default".into())
}

/// Split `data` into chunks of at most `max` bytes.
pub fn split_chunks(data: &[u8], max: usize) -> Vec<Vec<u8>> {
    if max == 0 {
        return vec![data.to_vec()];
    }
    data.chunks(max).map(|c| c.to_vec()).collect()
}

/// Drop-oldest queue for emit backpressure.
pub struct EmitQueue {
    chunks: VecDeque<Vec<u8>>,
    bytes: usize,
    overflow_logged: bool,
}

impl EmitQueue {
    pub fn new() -> Self {
        Self {
            chunks: VecDeque::new(),
            bytes: 0,
            overflow_logged: false,
        }
    }

    pub fn push(&mut self, chunk: Vec<u8>) {
        self.bytes += chunk.len();
        self.chunks.push_back(chunk);
        while self.chunks.len() > MAX_QUEUE_CHUNKS || self.bytes > MAX_QUEUE_BYTES {
            if let Some(old) = self.chunks.pop_front() {
                self.bytes = self.bytes.saturating_sub(old.len());
                if !self.overflow_logged {
                    eprintln!("[pty] queue overflow: dropping oldest chunk");
                    self.overflow_logged = true;
                }
            } else {
                break;
            }
        }
    }

    pub fn pop_all(&mut self) -> Vec<Vec<u8>> {
        self.bytes = 0;
        self.chunks.drain(..).collect()
    }
}

// ── Event payloads ──────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyDataEvent {
    pub session_id: String,
    pub data: String, // base64
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub session_id: String,
    pub code: Option<i32>,
    /// Monotonic generation for this session open; frontend ignores stale exits.
    pub generation: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOpenResult {
    pub reused: bool,
    pub generation: u64,
}

// ── Session handle ──────────────────────────────────────────────────────────

pub struct PtySession {
    cwd: PathBuf,
    /// True while reader threads should run.
    alive: Arc<AtomicBool>,
    /// Open generation; wait-thread exit must match current map entry.
    generation: u64,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    /// Killer cloned for use outside the wait thread.
    killer: Mutex<Option<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
    #[cfg(unix)]
    pgid: Option<i32>,
}

// ── Manager ─────────────────────────────────────────────────────────────────

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    next_generation: AtomicU64,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        }
    }

    fn next_gen(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::SeqCst)
    }

    pub fn kill_all(&self) {
        let mut map = self.sessions.lock().unwrap();
        let ids: Vec<String> = map.keys().cloned().collect();
        for id in ids {
            if let Some(sess) = map.remove(&id) {
                kill_session_handles(&sess);
            }
        }
    }

    fn list_ids(&self) -> Vec<String> {
        self.sessions.lock().unwrap().keys().cloned().collect()
    }
}

/// Count sessions whose `alive` flag is still true.
fn count_alive(sessions: &HashMap<String, PtySession>) -> usize {
    sessions
        .values()
        .filter(|s| s.alive.load(Ordering::SeqCst))
        .count()
}

fn kill_session_handles(sess: &PtySession) {
    sess.alive.store(false, Ordering::SeqCst);
    #[cfg(unix)]
    if let Some(pgid) = sess.pgid {
        // Negative pid = process group (best-effort).
        unsafe {
            libc::kill(-pgid, libc::SIGTERM);
        }
    }
    if let Ok(mut k) = sess.killer.lock() {
        if let Some(mut killer) = k.take() {
            let _ = killer.kill();
        }
    }
    // Drop writer → EOF to slave.
    if let Ok(mut w) = sess.writer.lock() {
        *w = None;
    }
    if let Ok(mut m) = sess.master.lock() {
        *m = None;
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn pty_open(
    app: AppHandle,
    state: State<'_, PtyManager>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<PtyOpenResult, String> {
    open_session(app, &state, session_id, cwd, cols, rows)
}

fn open_session(
    app: AppHandle,
    state: &PtyManager,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<PtyOpenResult, String> {
    if session_id.is_empty() {
        return Err("sessionId is empty".into());
    }
    let cwd_path = validate_cwd(&cwd)?;
    let cols = cols.max(2);
    let rows = rows.max(1);

    // Reuse / replace under lock, then spawn outside if needed.
    {
        let mut map = state.sessions.lock().unwrap();
        let exists = map.contains_key(&session_id);
        let alive_n = count_alive(&map);
        if !soft_cap_allows(alive_n, exists, MAX_PTY_SESSIONS) {
            return Err(format!(
                "Too many terminals open (max {MAX_PTY_SESSIONS}). Close a session first."
            ));
        }

        if let Some(sess) = map.get(&session_id) {
            if sess.alive.load(Ordering::SeqCst) && sess.cwd == cwd_path {
                // Reuse: resize only.
                let gen = sess.generation;
                if let Ok(guard) = sess.master.lock() {
                    if let Some(master) = guard.as_ref() {
                        let _ = master.resize(portable_pty::PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                    }
                }
                return Ok(PtyOpenResult {
                    reused: true,
                    generation: gen,
                });
            }
            // Different cwd or dead: tear down before recreate.
            if let Some(old) = map.remove(&session_id) {
                kill_session_handles(&old);
            }
        }
    }

    let generation = state.next_gen();
    let shell_pref = load_shell_pref(&app);
    let shell = resolve_shell(&shell_pref)?;
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = portable_pty::CommandBuilder::new(&shell);
    configure_shell_command(&mut cmd, &shell);
    cmd.cwd(&cwd_path);
    // Inherit process env (PATH already fixed by path_env::ensure_user_path).

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell failed: {e}"))?;

    #[cfg(unix)]
    let pgid = pair.master.process_group_leader();
    #[cfg(not(unix))]
    let pgid = None;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let killer = child.clone_killer();

    let alive = Arc::new(AtomicBool::new(true));
    let sess = PtySession {
        cwd: cwd_path,
        alive: Arc::clone(&alive),
        generation,
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(Some(pair.master)),
        killer: Mutex::new(Some(killer)),
        #[cfg(unix)]
        pgid,
    };
    // Silence unused on non-unix if we kept pgid local for symmetry.
    #[cfg(not(unix))]
    let _ = pgid;

    {
        let mut map = state.sessions.lock().unwrap();
        // Re-check soft cap after spawn (race with other opens).
        let exists = map.contains_key(&session_id);
        let alive_n = count_alive(&map);
        if !soft_cap_allows(alive_n, exists, MAX_PTY_SESSIONS) {
            kill_session_handles(&sess);
            return Err(format!(
                "Too many terminals open (max {MAX_PTY_SESSIONS}). Close a session first."
            ));
        }
        // Always kill displaced entry if concurrent open won the race.
        if let Some(displaced) = map.insert(session_id.clone(), sess) {
            kill_session_handles(&displaced);
        }
    }

    // Reader + coalesce path.
    start_reader(app.clone(), session_id.clone(), reader, Arc::clone(&alive));

    // Wait for child exit on a side thread.
    let wait_app = app.clone();
    let wait_id = session_id.clone();
    let wait_alive = Arc::clone(&alive);
    let wait_gen = generation;
    thread::Builder::new()
        .name(format!("pty-wait-{wait_id}"))
        .spawn(move || {
            let status = child.wait();
            wait_alive.store(false, Ordering::SeqCst);
            let code = status.ok().map(|s| s.exit_code() as i32);
            let _ = wait_app.emit(
                "pty:exit",
                PtyExitEvent {
                    session_id: wait_id.clone(),
                    code,
                    generation: wait_gen,
                },
            );
            // Leave entry until pty_kill / open replace — frontend may Restart.
            // Mark dead only via alive flag; map entry cleared on kill/open.
        })
        .map_err(|e| format!("spawn wait thread: {e}"))?;

    Ok(PtyOpenResult {
        reused: false,
        generation,
    })
}

fn start_reader(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    alive: Arc<AtomicBool>,
) {
    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();

    // Blocking reader → channel.
    let read_alive = Arc::clone(&alive);
    let sid_r = session_id.clone();
    thread::Builder::new()
        .name(format!("pty-read-{sid_r}"))
        .spawn(move || {
            let mut buf = vec![0u8; READ_BUF];
            while read_alive.load(Ordering::SeqCst) {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(n) => {
                        if tx.send(Some(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(_) => {
                        let _ = tx.send(None);
                        break;
                    }
                }
            }
        })
        .ok();

    // Coalesce + emit.
    let emit_alive = Arc::clone(&alive);
    let sid_e = session_id;
    thread::Builder::new()
        .name(format!("pty-emit-{sid_e}"))
        .spawn(move || {
            let mut pending: Vec<u8> = Vec::new();
            let mut queue = EmitQueue::new();
            let mut last_activity = Instant::now();

            loop {
                if !emit_alive.load(Ordering::SeqCst) && pending.is_empty() {
                    // Drain any remaining then exit.
                    while let Ok(msg) = rx.try_recv() {
                        match msg {
                            Some(d) => pending.extend_from_slice(&d),
                            None => break,
                        }
                    }
                    flush_pending(&app, &sid_e, &mut pending, &mut queue);
                    break;
                }

                match rx.recv_timeout(Duration::from_millis(COALESCE_MS)) {
                    Ok(Some(data)) => {
                        pending.extend_from_slice(&data);
                        last_activity = Instant::now();
                        if pending.len() >= COALESCE_BYTES {
                            flush_pending(&app, &sid_e, &mut pending, &mut queue);
                        }
                    }
                    Ok(None) => {
                        flush_pending(&app, &sid_e, &mut pending, &mut queue);
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if !pending.is_empty()
                            && coalesce_should_flush(pending.len(), last_activity.elapsed())
                        {
                            // On timeout with data, always flush (time path).
                            flush_pending(&app, &sid_e, &mut pending, &mut queue);
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        flush_pending(&app, &sid_e, &mut pending, &mut queue);
                        break;
                    }
                }
            }
        })
        .ok();
}

fn flush_pending(app: &AppHandle, session_id: &str, pending: &mut Vec<u8>, queue: &mut EmitQueue) {
    if pending.is_empty() {
        return;
    }
    let data = std::mem::take(pending);
    for chunk in split_chunks(&data, MAX_EMIT_RAW) {
        queue.push(chunk);
    }
    for chunk in queue.pop_all() {
        let payload = PtyDataEvent {
            session_id: session_id.to_string(),
            data: B64.encode(&chunk),
        };
        let _ = app.emit("pty:data", payload);
    }
}

#[tauri::command]
pub fn pty_write(
    state: State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    // Clone session lookup under map lock; hold only the per-session writer lock
    // during I/O so a blocked slave cannot stall kill_all / other sessions.
    let map = state.sessions.lock().unwrap();
    let sess = map
        .get(&session_id)
        .ok_or_else(|| format!("no pty for session {session_id}"))?;
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(format!("pty for session {session_id} has exited"));
    }
    // Writer mutex is per-session; write while holding map + writer (same as prior Unix path).
    let mut writer_guard = sess.writer.lock().unwrap();
    let writer = writer_guard
        .as_mut()
        .ok_or_else(|| format!("no writer for session {session_id}"))?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("pty write failed: {e}"))?;
    writer.flush().map_err(|e| format!("pty flush failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cols = cols.max(2);
    let rows = rows.max(1);
    let map = state.sessions.lock().unwrap();
    let sess = map
        .get(&session_id)
        .ok_or_else(|| format!("no pty for session {session_id}"))?;
    let master = sess.master.lock().unwrap();
    let master = master
        .as_ref()
        .ok_or_else(|| format!("no master for session {session_id}"))?;
    master
        .resize(portable_pty::PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, session_id: String) -> Result<(), String> {
    // Idempotent on all platforms.
    let mut map = state.sessions.lock().unwrap();
    if let Some(sess) = map.remove(&session_id) {
        kill_session_handles(&sess);
    }
    Ok(())
}

#[tauri::command]
pub fn pty_list(state: State<'_, PtyManager>) -> Result<Vec<String>, String> {
    Ok(state.list_ids())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn validate_cwd_rejects_empty() {
        assert!(validate_cwd("").is_err());
    }

    #[test]
    fn validate_cwd_rejects_file() {
        let dir = std::env::temp_dir().join(format!("hip-pty-file-{}", std::process::id()));
        std::fs::write(&dir, b"x").unwrap();
        let err = validate_cwd(dir.to_str().unwrap()).unwrap_err();
        assert!(err.contains("not a directory"), "{err}");
        let _ = std::fs::remove_file(&dir);
    }

    #[test]
    fn validate_cwd_accepts_directory() {
        let dir = std::env::temp_dir().join(format!("hip-pty-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let got = validate_cwd(dir.to_str().unwrap()).unwrap();
        assert_eq!(got, dir);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn soft_cap_logic() {
        // alive_count, not map.len — dead entries must not block new sessions.
        assert!(soft_cap_allows(0, false, 8));
        assert!(soft_cap_allows(7, false, 8));
        assert!(!soft_cap_allows(8, false, 8));
        assert!(soft_cap_allows(8, true, 8)); // existing session always allowed
        assert!(soft_cap_allows(100, true, 8));
    }

    #[test]
    fn coalesce_flush_on_size() {
        assert!(coalesce_should_flush(COALESCE_BYTES, Duration::from_millis(0)));
        assert!(coalesce_should_flush(COALESCE_BYTES + 1, Duration::from_millis(0)));
        assert!(!coalesce_should_flush(1, Duration::from_millis(0)));
    }

    #[test]
    fn coalesce_flush_on_time() {
        assert!(coalesce_should_flush(1, Duration::from_millis(COALESCE_MS)));
        assert!(coalesce_should_flush(1, Duration::from_millis(COALESCE_MS + 5)));
        assert!(!coalesce_should_flush(1, Duration::from_millis(COALESCE_MS - 1)));
        assert!(!coalesce_should_flush(0, Duration::from_millis(1000)));
    }

    #[test]
    fn split_chunks_respects_max() {
        let data = vec![1u8; 100];
        let chunks = split_chunks(&data, 40);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 40);
        assert_eq!(chunks[1].len(), 40);
        assert_eq!(chunks[2].len(), 20);
    }

    #[test]
    fn emit_queue_drops_oldest() {
        let mut q = EmitQueue::new();
        for i in 0..MAX_QUEUE_CHUNKS + 5 {
            q.push(vec![i as u8; 16]);
        }
        assert!(q.chunks.len() <= MAX_QUEUE_CHUNKS);
        let all = q.pop_all();
        assert!(all.len() <= MAX_QUEUE_CHUNKS);
        // Oldest indices 0..4 dropped; first remaining should be 5.
        assert_eq!(all[0][0], 5);
    }

    #[test]
    fn kill_idempotent_on_empty_manager() {
        let mgr = PtyManager::new();
        // Simulate command path: remove missing is ok.
        {
            let mut map = mgr.sessions.lock().unwrap();
            assert!(map.remove("missing").is_none());
        }
        mgr.kill_all(); // no panic
        assert!(mgr.list_ids().is_empty());
    }

    #[test]
    fn normalize_shell_pref_maps_known_values() {
        assert_eq!(normalize_shell_pref("CMD"), "cmd");
        assert_eq!(normalize_shell_pref("PowerShell"), "powershell");
        assert_eq!(normalize_shell_pref("  pwsh "), "pwsh");
        assert_eq!(normalize_shell_pref("bash"), "bash");
        assert_eq!(normalize_shell_pref("zsh"), "zsh");
        assert_eq!(normalize_shell_pref(""), "default");
        assert_eq!(normalize_shell_pref("nope"), "default");
    }

    #[test]
    fn resolve_shell_default_finds_something() {
        let shell = resolve_shell("default").expect("shell");
        assert!(shell.is_file(), "{shell:?}");
    }

    /// Smoke: open real PTY, write echo marker, wait for data, kill.
    #[test]
    fn pty_echo_smoke() {
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};
        use std::io::Write;

        let dir = std::env::temp_dir().join(format!("hip-pty-smoke-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let shell = resolve_shell("default").unwrap();
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();

        let mut cmd = CommandBuilder::new(&shell);
        configure_shell_command(&mut cmd, &shell);
        cmd.cwd(&dir);

        let mut child = pair.slave.spawn_command(cmd).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();

        // Give shell a moment to start, then echo a marker.
        thread::sleep(Duration::from_millis(300));
        #[cfg(windows)]
        {
            write!(writer, "echo hip-pty-marker\r\n").unwrap();
        }
        #[cfg(not(windows))]
        {
            write!(writer, "echo hip-pty-marker\n").unwrap();
        }
        writer.flush().unwrap();

        let mut collected = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut buf = [0u8; 4096];
        while Instant::now() < deadline {
            if let Ok(n) = reader.read(&mut buf) {
                if n > 0 {
                    collected.extend_from_slice(&buf[..n]);
                    if collected.windows(b"hip-pty-marker".len()).any(|w| w == b"hip-pty-marker") {
                        break;
                    }
                } else {
                    break;
                }
            } else {
                break;
            }
            if collected.len() > 64 * 1024 {
                break;
            }
        }

        let _ = child.kill();
        let _ = std::fs::remove_dir_all(&dir);

        let text = String::from_utf8_lossy(&collected);
        assert!(
            text.contains("hip-pty-marker"),
            "expected marker in PTY output, got: {text:?}"
        );
    }
}
