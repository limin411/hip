use crate::SidecarState;
use crate::tauri_info;
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

/// Product CLI discovery document (schemaVersion 1). Written by Tauri after handshake.
#[derive(Serialize)]
struct SidecarDiscoveryFile {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    pid: u32,
    port: u16,
    token: String,
    #[serde(rename = "startedAt")]
    started_at: String,
    #[serde(rename = "hipDataDir")]
    hip_data_dir: String,
    #[serde(rename = "appVersion")]
    app_version: Option<String>,
}

/// Atomically write `run/sidecar.json` (0600 on Unix) for product CLI attach.
pub fn write_discovery_file(app: &AppHandle, info: &SidecarInfo, sidecar_pid: u32) {
    let Some(path) = crate::paths::sidecar_discovery_path(app) else {
        eprintln!("[tauri] discovery: no run path");
        return;
    };
    let hip_data_dir = crate::paths::hip_base_dir(app)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let doc = SidecarDiscoveryFile {
        schema_version: 1,
        pid: sidecar_pid,
        port: info.port,
        token: info.token.clone(),
        started_at: chrono_lite_now(),
        hip_data_dir,
        app_version: app.package_info().version.to_string().into(),
    };
    let body = match serde_json::to_string_pretty(&doc) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[tauri] discovery: serialize failed: {e}");
            return;
        }
    };
    let tmp = path.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&tmp, body.as_bytes()) {
        eprintln!("[tauri] discovery: write temp failed: {e}");
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    if let Err(e) = std::fs::rename(&tmp, &path) {
        eprintln!("[tauri] discovery: rename failed: {e}");
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    tauri_info!("tauri", "discovery:written");
}

/// Delete discovery file if present (generation-aware callers should gate first).
pub fn remove_discovery_file(app: &AppHandle) {
    if let Some(path) = crate::paths::sidecar_discovery_path(app) {
        if path.exists() {
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!("[tauri] discovery: remove failed: {e}");
            } else {
                tauri_info!("tauri", "discovery:removed");
            }
        }
    }
}

fn chrono_lite_now() -> String {
    // RFC3339-ish without extra chrono dependency: use system time.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Sufficient for discovery freshness; CLI treats WS as authoritative.
    format!("{secs}")
}

pub fn parse_info_line(line: &str) -> Option<SidecarInfo> {
    serde_json::from_str::<SidecarInfo>(line.trim()).ok()
}

pub async fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    tauri_info!("tauri", "sidecar:spawn");
    let mut cmd = app.shell().sidecar("sidecar").map_err(|e| e.to_string())?;
    // Inject each configured provider's API key as HIP_MODEL_<ID>_API_KEY
    // (empty string when absent → overrides any inherited env so a cleared key
    // truly disables that provider). The sidecar picks the active provider's key.
    for id in configured_provider_ids(app) {
        let env = provider_key_env(&id);
        match read_provider_key(app, &id) {
            Some(key) => cmd = cmd.env(&env, key),
            None => cmd = cmd.env(&env, ""),
        }
    }
    // Point the sidecar at the unified TOML config (single source of truth for
    // mcpServers, skills, providers, agents, permissions). The sidecar resolves
    // effective config by merging this global hip.toml with a project-level
    // .hip/hip.toml. Legacy per-domain JSON files are no longer read.
    if let Some(p) = crate::paths::hip_config_path(app) {
        cmd = cmd.env("HIP_CONFIG_PATH", p.to_string_lossy().into_owned());
    }
    // Cross-session memory flags/config (memory.json under the same config root).
    if let Some(dir) = crate::paths::config_dir(app) {
        cmd = cmd.env(
            "HIP_MEMORY_CONFIG_PATH",
            dir.join("memory.json").to_string_lossy().into_owned(),
        );
    }
    // Providers are read from hip.toml via HIP_CONFIG_PATH; no separate env var needed.
    // Point the sidecar at the plugin registry (installed plugin manifests).
    if let Some(p) = crate::paths::plugins_config_path(app) {
        cmd = cmd.env("HIP_PLUGINS_PATH", p.to_string_lossy().into_owned());
    }
    // Point the sidecar at the installed plugins directory.
    if let Some(p) = crate::paths::plugins_dir(app) {
        cmd = cmd.env("HIP_PLUGINS_DIR", p.to_string_lossy().into_owned());
    }
    // Point the sidecar at global Claude-format skills (~/.hip/skills or HIP_DATA_DIR/skills).
    // Without this, Settings can list global skills that the agent never loads.
    if let Some(p) = crate::paths::skills_dir(app) {
        cmd = cmd.env("HIP_SKILLS_DIR", p.to_string_lossy().into_owned());
    }
    // Tell the sidecar where to persist sessions. paths::db_dir creates the dir; if it's
    // unavailable the sidecar falls back to an in-memory DB rather than failing to start.
    if let Some(dir) = crate::paths::db_dir(app) {
        cmd = cmd.env("HIP_DB_PATH", db_path_for(&dir).to_string_lossy().into_owned());
    }
    // Make the cross-platform root authoritative for scratch too (Windows consistency).
    // On macOS/Linux this equals scratch.ts's existing default, so behavior is unchanged.
    if let Some(dir) = crate::paths::scratch_dir(app) {
        cmd = cmd.env("HIP_SCRATCH_ROOT", dir.to_string_lossy().into_owned());
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
    // HTTP(S) proxy from hip.toml `[proxy]` (Settings → General). When enabled,
    // override sidecar proxy env so web tools / fetches honor user settings.
    // When disabled, process env (Clash etc.) still applies if the shell inherits it.
    if let Ok(cfg) = crate::hip_config::load_hip_config(app) {
        if let Some(proxy) = cfg.proxy {
            if proxy.enabled == Some(true) {
                let apply = |raw: Option<&str>| -> String {
                    raw.map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or("")
                        .to_string()
                };
                let http = apply(proxy.http.as_deref());
                let https = apply(proxy.https.as_deref());
                let all = apply(proxy.all.as_deref());
                let no = apply(proxy.no_proxy.as_deref());
                cmd = cmd
                    .env("HTTP_PROXY", &http)
                    .env("http_proxy", &http)
                    .env("HTTPS_PROXY", &https)
                    .env("https_proxy", &https)
                    .env("ALL_PROXY", &all)
                    .env("all_proxy", &all)
                    .env("NO_PROXY", &no)
                    .env("no_proxy", &no);
            }
        }
    }
    let (mut rx, child) = cmd.spawn().map_err(|e| e.to_string())?;
    // Sidecar child pid for product CLI discovery (not the Tauri host pid).
    let sidecar_pid = child.pid();

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
                            tauri_info!("tauri", "sidecar:ready");
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
                    tauri_info!("tauri", "sidecar:exit");
                    eprintln!("[sidecar] terminated: {payload:?}");
                    let state = app_handle.state::<SidecarState>();
                    // Only clear if we're still the current generation — a restart that
                    // already installed a newer child/port must not be clobbered.
                    if state.generation.load(Ordering::SeqCst) == my_gen {
                        *state.port.lock().unwrap() = None;
                        *state.token.lock().unwrap() = None;
                        *state.child.lock().unwrap() = None;
                        remove_discovery_file(&app_handle);
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
    // Product CLI attach: stable discovery file (pid = sidecar child).
    write_discovery_file(app, &info, sidecar_pid);
    Ok(info.port)
}

/// Env-var name for a provider's API key (mirrors
/// protocol's `providerKeyEnv`). Keep the three impls (TS protocol, TS sidecar,
/// this) in sync.
pub fn provider_key_env(provider_id: &str) -> String {
    let norm: String = provider_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
        .collect();
    format!("HIP_MODEL_{norm}_API_KEY")
}

/// Read a provider's API key from the file store (key name == env var name).
pub fn read_provider_key(app: &AppHandle, provider_id: &str) -> Option<String> {
    crate::get_secret_value(app, &provider_key_env(provider_id))
}

fn configured_provider_ids(app: &AppHandle) -> Vec<String> {
    // Always seed deepseek + virtual memory endpoint slots so stored keys are
    // injected as env on spawn (matches chat providers; needed for key probe).
    let mut ids = vec![
        "deepseek".to_string(),
        "hip-memory-embedding".to_string(),
        "hip-memory-rerank".to_string(),
    ];
    if let Some(path) = crate::paths::hip_config_path(app) {
        if let Ok(body) = std::fs::read_to_string(&path) {
            if let Ok(v) = toml::from_str::<toml::Value>(&body) {
                if let Some(arr) = v.get("providers").and_then(|p| p.as_array()) {
                    for entry in arr {
                        if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                            if !ids.contains(&id.to_string()) {
                                ids.push(id.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    ids
}

/// The sidecar's SQLite file is named `hip.db` inside the `db/` dir.
pub fn db_path_for(data_dir: &Path) -> PathBuf {
    data_dir.join("hip.db")
}

#[cfg(test)]
mod tests {
    use super::{parse_info_line, provider_key_env};
    use std::path::PathBuf;

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

    // spawn_sidecar injects HIP_CONFIG_PATH → <base>/config/hip.toml.
    // The sidecar reads this env var in readHipConfig()/resolveEffectiveConfig().
    #[test]
    #[cfg(not(windows))]
    fn hip_config_path_points_at_base_config_hip_toml() {
        let base = crate::paths::hip_base_from(
            Some(PathBuf::from("/Users/me")),
            None,
        )
        .unwrap();
        let config_path = base.join("config").join("hip.toml");
        assert_eq!(
            config_path,
            PathBuf::from("/Users/me/.hip/config/hip.toml"),
        );
    }

}
