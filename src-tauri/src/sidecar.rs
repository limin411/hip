use serde::Deserialize;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Deserialize)]
struct PortMsg {
    port: u16,
}

pub async fn spawn_sidecar() -> Result<u16, String> {
    // Dev mode: run sidecar via yarn workspace
    // Production: replace with a bundled binary invocation
    let mut child = Command::new("yarn")
        .args(["workspace", "@hip/sidecar", "dev"])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    let stdout = child.stdout.take().ok_or("sidecar has no stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
        if let Ok(msg) = serde_json::from_str::<PortMsg>(&line) {
            // Keep child alive by leaking (process lives for app lifetime)
            std::mem::forget(child);
            return Ok(msg.port);
        }
    }
    Err("sidecar exited before reporting port".into())
}
