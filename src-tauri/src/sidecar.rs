use crate::SidecarState;
use serde::Deserialize;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize)]
struct PortMsg {
    port: u16,
}

pub fn parse_port_line(line: &str) -> Option<u16> {
    serde_json::from_str::<PortMsg>(line.trim()).ok().map(|m| m.port)
}

pub async fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let mut cmd = app.shell().sidecar("sidecar").map_err(|e| e.to_string())?;
    if let Some(key) = read_api_key() {
        cmd = cmd.env("DEEPSEEK_API_KEY", key);
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;

    *app.state::<SidecarState>().child.lock().unwrap() = Some(child);

    let app_handle = app.clone();
    let (port_tx, port_rx) = tokio::sync::oneshot::channel::<u16>();
    tauri::async_runtime::spawn(async move {
        let mut port_tx = Some(port_tx);
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if port_tx.is_some() {
                        if let Some(port) = parse_port_line(&line) {
                            if let Some(tx) = port_tx.take() {
                                let _ = tx.send(port);
                            }
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
                    *app_handle.state::<SidecarState>().port.lock().unwrap() = None;
                    *app_handle.state::<SidecarState>().child.lock().unwrap() = None;
                    break;
                }
                _ => {}
            }
        }
    });

    port_rx
        .await
        .map_err(|_| "sidecar exited before reporting port".to_string())
}

/// DEEPSEEK_API_KEY from env (dev) first, then the OS keychain (production).
pub fn read_api_key() -> Option<String> {
    if let Ok(v) = std::env::var("DEEPSEEK_API_KEY") {
        if !v.is_empty() {
            return Some(v);
        }
    }
    crate::get_secret_value("DEEPSEEK_API_KEY")
}

#[cfg(test)]
mod tests {
    use super::parse_port_line;

    #[test]
    fn parses_port_json() {
        assert_eq!(parse_port_line("{\"port\":54321}"), Some(54321));
        assert_eq!(parse_port_line("  {\"port\":7}  \n"), Some(7));
    }

    #[test]
    fn ignores_non_port_lines() {
        assert_eq!(parse_port_line("starting up"), None);
        assert_eq!(parse_port_line("{\"foo\":1}"), None);
        assert_eq!(parse_port_line(""), None);
    }
}
