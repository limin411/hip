use crate::SidecarState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
    // Inject each configured provider's keychain key as HIP_MODEL_<ID>_API_KEY
    // (empty string when absent → overrides any inherited env so a cleared key
    // truly disables that provider). The sidecar picks the active provider's key.
    for id in configured_provider_ids(app) {
        let env = provider_key_env(&id);
        match read_provider_key(&id) {
            Some(key) => cmd = cmd.env(&env, key),
            None => cmd = cmd.env(&env, ""),
        }
    }
    // Point the sidecar at the non-secret providers config (active model + base URLs).
    if let Ok(dir) = app.path().app_data_dir() {
        cmd = cmd.env("HIP_PROVIDERS_PATH", dir.join("hip-providers.json").to_string_lossy().into_owned());
    }
    // Tell the sidecar where to persist sessions (the app data dir). Create the dir
    // so the first launch on a fresh machine succeeds; if it's unavailable the
    // sidecar falls back to an in-memory DB rather than failing to start.
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        cmd = cmd.env("HIP_DB_PATH", db_path_for(&dir).to_string_lossy().into_owned());
    }
    // Tie the sidecar's lifetime to ours. tauri-plugin-shell pipes the child's
    // stdin and holds the write end, so when this app process dies by ANY means —
    // including the SIGTERM/SIGKILL the WebdriverIO E2E harness sends, which run
    // none of our exit handlers — the kernel closes that pipe and the sidecar sees
    // EOF. HIP_PARENT_WATCH tells it to exit on that EOF (see main.ts), preventing
    // the orphaned `node … sidecar/src/main.ts` that held the SQLite lock between
    // runs. Both the dev wrapper (which `exec`s node, inheriting this env) and the
    // bundled binary go through this same spawn, so both paths are covered.
    cmd = cmd.env("HIP_PARENT_WATCH", "1");
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

/// Keychain entry name AND env var name for a provider's API key (mirrors
/// protocol's `providerKeyEnv`). Keep the three impls (TS protocol, TS sidecar,
/// this) in sync.
pub fn provider_key_env(provider_id: &str) -> String {
    let norm: String = provider_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
        .collect();
    format!("HIP_MODEL_{norm}_API_KEY")
}

/// Read the keychain key for a provider (keychain entry name == env var name).
pub fn read_provider_key(provider_id: &str) -> Option<String> {
    crate::get_secret_value(&provider_key_env(provider_id))
}

/// Provider ids present in hip-providers.json (always includes "deepseek" so the
/// out-of-box DeepSeek path keeps working before the user opens the new page).
fn configured_provider_ids(app: &AppHandle) -> Vec<String> {
    let mut ids = vec!["deepseek".to_string()];
    if let Ok(dir) = app.path().app_data_dir() {
        let path = dir.join("hip-providers.json");
        if let Ok(body) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(map) = v.get("providers").and_then(|p| p.as_object()) {
                    for k in map.keys() {
                        if !ids.contains(k) { ids.push(k.clone()); }
                    }
                }
            }
        }
    }
    ids
}

/// The sidecar's SQLite file lives in the app data dir as `hip.db`.
pub fn db_path_for(data_dir: &Path) -> PathBuf {
    data_dir.join("hip.db")
}

#[cfg(test)]
mod tests {
    use super::{parse_info_line, provider_key_env};

    #[test]
    fn provider_key_env_matches_ts_normalization() {
        // Must stay in lockstep with @hip/protocol's providerKeyEnv (see providers.test.ts).
        assert_eq!(provider_key_env("deepseek"), "HIP_MODEL_DEEPSEEK_API_KEY");
        assert_eq!(provider_key_env("github-copilot"), "HIP_MODEL_GITHUB_COPILOT_API_KEY");
    }

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

    #[test]
    fn db_path_is_hip_db_under_data_dir() {
        let p = super::db_path_for(std::path::Path::new("/tmp/app"));
        assert_eq!(p, std::path::PathBuf::from("/tmp/app/hip.db"));
    }
}
