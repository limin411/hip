//! Ghostty terminal backend: libghostty-vt integration for hip.
//!
//! Each session owns a dedicated thread running a libghostty-vt `Terminal`.
//! PTY data flows: PTY reader → channel → Terminal.vt_write() → Formatter VT → emit.
//!
//! See docs/design/terminal-ghostty-kernel/terminal-ghostty-kernel-spec.md

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use libghostty_vt::fmt::{Format, Formatter, FormatterOptions};
use libghostty_vt::Terminal;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::hip_config::TomlHipConfig;
use crate::paths;
use crate::terminal_budget::{self, TerminalBudget, MAX_INTERACTIVE_TERMINALS};

/// Read buffer for PTY reader thread.
const READ_BUF: usize = 16 * 1024;

/// Coalesce idle window for VT output.
const COALESCE_MS: u64 = 8;

/// Max raw bytes per emit event.
const MAX_EMIT_RAW: usize = 192 * 1024;

// ── Events ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct GhosttyDataEvent {
    session_id: String,
    data: String, // base64 encoded VT sequences
}

#[derive(Serialize, Clone)]
struct GhosttyExitEvent {
    session_id: String,
    code: Option<i32>,
    generation: u64,
}

// ── Session ─────────────────────────────────────────────────────────────────

struct GhosttySession {
    /// Current working directory.
    cwd: PathBuf,
    /// True while reader threads should run.
    alive: Arc<AtomicBool>,
    /// Open generation.
    generation: u64,
    /// Writer to PTY master.
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    /// PTY master (for resize).
    master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    /// Child killer.
    killer: Mutex<Option<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
    /// Channel sender to feed data to the terminal thread.
    data_tx: mpsc::Sender<Vec<u8>>,
    /// Channel sender to request resize.
    resize_tx: mpsc::Sender<(u16, u16)>,
    #[cfg(unix)]
    pgid: Option<i32>,
}

// ── Manager ─────────────────────────────────────────────────────────────────

pub struct GhosttyManager {
    sessions: Mutex<HashMap<String, GhosttySession>>,
    next_generation: AtomicU64,
}

impl GhosttyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        }
    }

    fn next_gen(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::SeqCst)
    }

    pub fn kill_all(&self, budget: &TerminalBudget) {
        let mut map = self.sessions.lock().unwrap();
        let ids: Vec<String> = map.keys().cloned().collect();
        for id in ids {
            if let Some(sess) = map.remove(&id) {
                kill_session_handles(&sess);
                budget.release(&id);
            }
        }
    }
}

fn kill_session_handles(sess: &GhosttySession) {
    sess.alive.store(false, Ordering::SeqCst);
    #[cfg(unix)]
    if let Some(pgid) = sess.pgid {
        unsafe {
            libc::kill(-pgid, libc::SIGTERM);
        }
    }
    if let Ok(mut k) = sess.killer.lock() {
        if let Some(mut killer) = k.take() {
            let _ = killer.kill();
        }
    }
    if let Ok(mut w) = sess.writer.lock() {
        w.take();
    }
    if let Ok(mut m) = sess.master.lock() {
        m.take();
    }
}

// ── Shell detection (reuse pty.rs logic) ────────────────────────────────────

fn load_shell_pref(app: &AppHandle) -> String {
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
        .map(|s| crate::pty::normalize_shell_pref(&s).to_string())
        .unwrap_or_else(|| "default".into())
}

fn load_max_scrollback(_app: &AppHandle) -> usize {
    // TODO: read from [terminal].max_scrollback in hip.toml when field is added.
    10000
}

// ── Terminal thread ─────────────────────────────────────────────────────────

/// Spawn the terminal thread that owns the libghostty-vt Terminal.
/// Reads from data_rx, writes VT output to app via emit.
fn spawn_terminal_thread(
    app: AppHandle,
    session_id: String,
    cols: u16,
    rows: u16,
    max_scrollback: usize,
    data_rx: mpsc::Receiver<Vec<u8>>,
    resize_rx: mpsc::Receiver<(u16, u16)>,
    alive: Arc<AtomicBool>,
    generation: u64,
) {
    let sid = session_id.clone();
    thread::Builder::new()
        .name(format!("ghostty-term-{sid}"))
        .spawn(move || {
            // Create the libghostty-vt terminal.
            let mut terminal = match Terminal::new(libghostty_vt::terminal::Options {
                cols,
                rows,
                max_scrollback,
            }) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("[ghostty] Terminal::new failed: {e}");
                    let _ = app.emit(
                        "ghostty:exit",
                        GhosttyExitEvent {
                            session_id: session_id.clone(),
                            code: Some(-1),
                            generation,
                        },
                    );
                    return;
                }
            };

            // Register effect callbacks.
            // on_pty_write: respond to shell queries (device attributes, etc.)
            let pty_resp_tx: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>> =
                Arc::new(Mutex::new(None));

            {
                let resp_tx = pty_resp_tx.clone();
                let _ = terminal.on_pty_write(move |_term, data| {
                    if let Ok(guard) = resp_tx.lock() {
                        if let Some(tx) = guard.as_ref() {
                            let _ = tx.send(data.to_vec());
                        }
                    }
                });
            }

            // on_bell: emit bell event
            let bell_app = app.clone();
            let bell_sid = session_id.clone();
            let _ = terminal.on_bell(move |_term| {
                let _ = bell_app.emit("ghostty:bell", &bell_sid);
            });

            // on_title_changed: emit title event
            let title_app = app.clone();
            let title_sid = session_id.clone();
            let _ = terminal.on_title_changed(move |term| {
                if let Ok(title) = term.title() {
                    let _ = title_app.emit(
                        "ghostty:title",
                        serde_json::json!({ "session_id": title_sid, "title": title }),
                    );
                }
            });

            // Channel for pty_write responses (shell → PTY).
            let (pty_write_tx, pty_write_rx) = mpsc::channel::<Vec<u8>>();
            {
                if let Ok(mut guard) = pty_resp_tx.lock() {
                    *guard = Some(pty_write_tx);
                }
            }

            // Main loop: process data from PTY, handle resizes, flush pty_write responses.
            let mut last_emit = Instant::now();
            let mut pending_vt: Vec<u8> = Vec::new();

            loop {
                // Check alive
                if !alive.load(Ordering::SeqCst) {
                    // Drain remaining data
                    while let Ok(msg) = data_rx.try_recv() {
                        terminal.vt_write(&msg);
                    }
                    break;
                }

                // Handle resize requests
                while let Ok((new_cols, new_rows)) = resize_rx.try_recv() {
                    let _ = terminal.resize(new_cols, new_rows, 0, 0);
                }

                // Read PTY data with timeout
                match data_rx.recv_timeout(Duration::from_millis(COALESCE_MS)) {
                    Ok(data) => {
                        terminal.vt_write(&data);

                        // Use Formatter to get VT sequences for JS rendering.
                        // This is Phase 1: VT sequence replay.
                        match Formatter::new(
                            &terminal,
                            FormatterOptions::new().with_format(Format::Vt),
                        ) {
                            Ok(mut formatter) => match formatter.format_alloc(None) {
                                Ok(vt_bytes) => {
                                    pending_vt.extend_from_slice(&vt_bytes);
                                }
                                Err(e) => {
                                    eprintln!("[ghostty] Formatter::format_alloc error: {e}");
                                }
                            },
                            Err(e) => {
                                eprintln!("[ghostty] Formatter::new error: {e}");
                            }
                        }

                        // Flush pending VT data if enough has accumulated
                        let elapsed = last_emit.elapsed();
                        if !pending_vt.is_empty()
                            && (pending_vt.len() >= MAX_EMIT_RAW
                                || elapsed >= Duration::from_millis(COALESCE_MS))
                        {
                            emit_vt_data(&app, &session_id, &pending_vt);
                            pending_vt.clear();
                            last_emit = Instant::now();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Flush any pending data on idle
                        if !pending_vt.is_empty() {
                            emit_vt_data(&app, &session_id, &pending_vt);
                            pending_vt.clear();
                            last_emit = Instant::now();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        // PTY closed
                        break;
                    }
                }

                // Flush pty_write responses (shell queries → PTY)
                // These are responses to device attribute queries etc.
                // They need to be written back to the PTY master.
                while let Ok(_resp) = pty_write_rx.try_recv() {
                    // TODO: integrate with session writer for shell query responses
                    // For now, shell queries are silently dropped.
                    // This is acceptable for Phase 1 — programs will fall back to defaults.
                }
            }

            // Emit exit event
            let _ = app.emit(
                "ghostty:exit",
                GhosttyExitEvent {
                    session_id: session_id.clone(),
                    code: None,
                    generation,
                },
            );
        })
        .ok();
}

fn emit_vt_data(app: &AppHandle, session_id: &str, data: &[u8]) {
    let _ = app.emit(
        "ghostty:data",
        GhosttyDataEvent {
            session_id: session_id.to_string(),
            data: B64.encode(data),
        },
    );
}

/// PTY reader thread: reads from PTY master, sends data to terminal thread.
fn start_pty_reader(
    _app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    alive: Arc<AtomicBool>,
    data_tx: mpsc::Sender<Vec<u8>>,
) {
    let sid = session_id.clone();
    thread::Builder::new()
        .name(format!("ghostpty-read-{sid}"))
        .spawn(move || {
            let mut buf = vec![0u8; READ_BUF];
            while alive.load(Ordering::SeqCst) {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if data_tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        })
        .ok();
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct GhosttyOpenResult {
    pub reused: bool,
    pub generation: u64,
}

#[tauri::command]
pub fn ghostty_open(
    app: AppHandle,
    state: State<'_, GhosttyManager>,
    budget: State<'_, TerminalBudget>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<GhosttyOpenResult, String> {
    if session_id.is_empty() {
        return Err("sessionId is empty".into());
    }
    let cwd_path = crate::pty::validate_cwd(&cwd)?;
    let cols = cols.max(2);
    let rows = rows.max(1);

    let max_scrollback = load_max_scrollback(&app);
    let shell = load_shell_pref(&app);

    let mut map = state.sessions.lock().unwrap();
    let exists = map.contains_key(&session_id);

    // Check for reuse
    if let Some(sess) = map.get(&session_id) {
        if sess.alive.load(Ordering::SeqCst) && sess.cwd == cwd_path {
            let _ = budget.try_acquire(&session_id, true);
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
            let _ = sess.resize_tx.send((cols, rows));
            return Ok(GhosttyOpenResult {
                reused: true,
                generation: gen,
            });
        }
        // Different cwd or dead: tear down before recreate.
        if let Some(old) = map.remove(&session_id) {
            kill_session_handles(&old);
            budget.release(&session_id);
        }
    }

    // Acquire budget slot.
    let acquired = budget
        .try_acquire(&session_id, exists)
        .map_err(|e| e.to_string())?;
    if !acquired {
        return Err(format!(
            "max {} interactive terminals reached",
            MAX_INTERACTIVE_TERMINALS
        ));
    }

    let generation = state.next_gen();

    // Create PTY.
    let pty_system = portable_pty::native_pty_system();
    let pty_size = portable_pty::PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = match pty_system.openpty(pty_size) {
        Ok(p) => p,
        Err(e) => {
            budget.release(&session_id);
            return Err(format!("openpty failed: {e}"));
        }
    };

    let mut cmd = portable_pty::CommandBuilder::new(&shell);
    crate::pty::configure_shell_command(&mut cmd, std::path::Path::new(&shell));
    cmd.cwd(&cwd_path);

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            budget.release(&session_id);
            return Err(format!("spawn shell failed: {e}"));
        }
    };

    #[cfg(unix)]
    let pgid = pair.master.process_group_leader();
    #[cfg(not(unix))]
    let pgid: Option<i32> = None;

    let reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            budget.release(&session_id);
            return Err(format!("clone reader failed: {e}"));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            budget.release(&session_id);
            return Err(format!("take writer failed: {e}"));
        }
    };

    let killer = child.clone_killer();
    let alive = Arc::new(AtomicBool::new(true));

    // Channels for terminal thread communication.
    let (data_tx, data_rx) = mpsc::channel::<Vec<u8>>();
    let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>();

    let sess = GhosttySession {
        cwd: cwd_path,
        alive: Arc::clone(&alive),
        generation,
        writer: Mutex::new(Some(writer)),
        master: Mutex::new(Some(pair.master)),
        killer: Mutex::new(Some(killer)),
        data_tx: data_tx.clone(),
        resize_tx: resize_tx.clone(),
        #[cfg(unix)]
        pgid,
    };

    if let Some(displaced) = map.insert(session_id.clone(), sess) {
        kill_session_handles(&displaced);
    }
    // Release the map lock before spawning threads.
    drop(map);

    // Start PTY reader thread → feeds data to terminal thread.
    start_pty_reader(
        app.clone(),
        session_id.clone(),
        reader,
        Arc::clone(&alive),
        data_tx,
    );

    // Start terminal thread (owns libghostty-vt Terminal).
    spawn_terminal_thread(
        app.clone(),
        session_id.clone(),
        cols,
        rows,
        max_scrollback,
        data_rx,
        resize_rx,
        Arc::clone(&alive),
        generation,
    );

    // Wait for child exit.
    let wait_app = app.clone();
    let wait_id = session_id.clone();
    let wait_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name(format!("ghostty-wait-{wait_id}"))
        .spawn(move || {
            let status = child.wait();
            wait_alive.store(false, Ordering::SeqCst);
            let code = status.ok().map(|s| s.exit_code() as i32);
            let _ = wait_app.emit(
                "ghostty:exit",
                GhosttyExitEvent {
                    session_id: wait_id,
                    code,
                    generation,
                },
            );
        })
        .map_err(|e| {
            budget.release(&session_id);
            format!("spawn wait thread: {e}")
        })?;

    Ok(GhosttyOpenResult {
        reused: false,
        generation,
    })
}

#[tauri::command]
pub fn ghostty_write(
    state: State<'_, GhosttyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let map = state.sessions.lock().unwrap();
    let sess = map
        .get(&session_id)
        .ok_or_else(|| format!("session {session_id} not found"))?;
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(format!("session {session_id} is not alive"));
    }
    if let Ok(mut guard) = sess.writer.lock() {
        if let Some(writer) = guard.as_mut() {
            writer
                .write_all(data.as_bytes())
                .map_err(|e| format!("write failed: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ghostty_resize(
    state: State<'_, GhosttyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.sessions.lock().unwrap();
    let sess = map
        .get(&session_id)
        .ok_or_else(|| format!("session {session_id} not found"))?;
    if !sess.alive.load(Ordering::SeqCst) {
        return Err(format!("session {session_id} is not alive"));
    }
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
    let _ = sess.resize_tx.send((cols, rows));
    Ok(())
}

#[tauri::command]
pub fn ghostty_kill(
    state: State<'_, GhosttyManager>,
    budget: State<'_, TerminalBudget>,
    session_id: String,
) -> Result<(), String> {
    let mut map = state.sessions.lock().unwrap();
    if let Some(sess) = map.remove(&session_id) {
        kill_session_handles(&sess);
        budget.release(&session_id);
    }
    Ok(())
}

#[tauri::command]
pub fn ghostty_scroll(
    state: State<'_, GhosttyManager>,
    session_id: String,
    delta: i32,
) -> Result<(), String> {
    // Scroll is handled on the terminal thread via RenderState viewport.
    // For now, this is a no-op — scrollback viewing will be implemented in PR-2.
    let _ = (state, session_id, delta);
    Ok(())
}
