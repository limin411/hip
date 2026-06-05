use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize)]
struct PortMsg {
    port: u16,
}

pub async fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("sidecar")
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line_bytes) = event {
            let text = String::from_utf8_lossy(&line_bytes);
            if let Ok(msg) = serde_json::from_str::<PortMsg>(text.trim()) {
                return Ok(msg.port);
            }
        }
    }
    Err("sidecar exited before reporting port".into())
}
