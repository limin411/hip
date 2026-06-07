use crate::SidecarState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize, Serialize, Clone)]
pub struct SidecarInfo {
    pub port: u16,
    pub token: String,
}

pub fn parse_info_line(line: &str) -> Option<SidecarInfo> {
    serde_json::from_str::<SidecarInfo>(line.trim()).ok()
}

pub async fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let mut cmd = app.shell().sidecar("sidecar").map_err(|e| e.to_string())?;
    // Inject the keychain key, or an empty value to OVERRIDE any inherited
    // DEEPSEEK_API_KEY (the child inherits the parent env). Empty → the sidecar's
    // NO_API_KEY guard fires, so a cleared key truly disables the agent.
    cmd = match read_api_key() {
        Some(key) => cmd.env("DEEPSEEK_API_KEY", key),
        None => cmd.env("DEEPSEEK_API_KEY", ""),
    };
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;

    let state = app.state::<SidecarState>();
    let my_gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.child.lock().unwrap() = Some(child);

    let app_handle = app.clone();
    let (info_tx, info_rx) = tokio::sync::oneshot::channel::<SidecarInfo>();
    tauri::async_runtime::spawn(async move {
        let mut info_tx_slot = Some(info_tx);
        let mut known_token: Option<String> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if info_tx_slot.is_some() {
                        if let Some(info) = parse_info_line(&line) {
                            known_token = Some(info.token.clone());
                            if let Some(tx) = info_tx_slot.take() {
                                let _ = tx.send(info);
                            }
                            continue;
                        }
                    }
                    // Defense-in-depth: never echo a line containing the auth token.
                    if let Some(tok) = &known_token {
                        if line.contains(tok.as_str()) {
                            continue;
                        }
                    }
                    print!("[sidecar] {line}");
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!("[sidecar] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[sidecar] terminated: {payload:?}");
                    let state = app_handle.state::<SidecarState>();
                    // Only clear if we're still the current generation — a restart that
                    // already installed a newer child/port must not be clobbered.
                    if state.generation.load(Ordering::SeqCst) == my_gen {
                        *state.port.lock().unwrap() = None;
                        *state.token.lock().unwrap() = None;
                        *state.child.lock().unwrap() = None;
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    let info = info_rx
        .await
        .map_err(|_| "sidecar exited before reporting info".to_string())?;
    // Store the auth token; return the port so callers can store it.
    *app.state::<SidecarState>().token.lock().unwrap() = Some(info.token.clone());
    Ok(info.port)
}

/// The sidecar's API key comes ONLY from the OS keychain — the single source of
/// truth the user controls via Settings. We deliberately do NOT fall back to the
/// process env: the spawned sidecar inherits the parent env, so an inherited (or
/// dev `.env`) DEEPSEEK_API_KEY would otherwise mask an explicit "clear" in the UI.
pub fn read_api_key() -> Option<String> {
    crate::get_secret_value("DEEPSEEK_API_KEY")
}

#[cfg(test)]
mod tests {
    use super::parse_info_line;

    #[test]
    fn parses_port_and_token() {
        let info = parse_info_line("{\"port\":54321,\"token\":\"abc\"}").unwrap();
        assert_eq!(info.port, 54321);
        assert_eq!(info.token, "abc");
    }

    #[test]
    fn parses_port_and_token_with_whitespace() {
        let info = parse_info_line("  {\"port\":7,\"token\":\"xyz\"}  \n").unwrap();
        assert_eq!(info.port, 7);
        assert_eq!(info.token, "xyz");
    }

    #[test]
    fn ignores_non_info_lines() {
        assert!(parse_info_line("starting up").is_none());
        assert!(parse_info_line("{\"port\":7}").is_none()); // missing token
        assert!(parse_info_line("").is_none());
    }
}
