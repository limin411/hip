mod sidecar;
mod paths;
mod auth;
mod atomic_write;
mod skills;
mod plugins;
mod marketplace;
mod mcp_registry;
mod path_env;
mod logging;
mod hip_config;
mod window_tray;
mod path_tools;
mod pty;
mod term_fs;
mod workspace_file_search;
mod terminal_hosts;
mod work_items;
mod work_items_trash;
mod work_items_ui_prefs;
mod automations;
mod automations_trash;
mod terminal_budget;
mod ssh_path;
mod ssh_known_hosts;
mod sftp_path;
mod knowledge;
mod knowledge_trash;
mod knowledge_link_index;
mod voice_models;
mod voice;
mod provider_logo;
// Production SSH (default feature `ssh`); stubs keep IPC registered when stripped.
#[cfg(feature = "ssh")]
mod ssh_session;
#[cfg(not(feature = "ssh"))]
#[path = "ssh_session_stub.rs"]
mod ssh_session;
// SFTP (PR6) — same feature gate as SSH; stubs keep IPC when stripped.
#[cfg(feature = "ssh")]
mod sftp;
#[cfg(not(feature = "ssh"))]
#[path = "sftp_stub.rs"]
mod sftp;

// Re-export so command handlers and unit tests can use `super::HipConfig` etc.
use hip_config::{HipConfig, TomlHipConfig, NetworkPolicyConfig};
#[cfg(test)]
use hip_config::{
    ActiveModel, AgentEntry, AgentLoopConfig, BoundModel, McpServerEntry,
    PermissionEntry, ProviderEntry, SkillEntry, ToolPermissionConfig, TomlActiveModel,
    TomlAgentEntry, TomlBoundModel, TomlMcpServerEntry, TomlPermissionEntry, TomlProviderEntry,
    TomlSkillEntry, TomlToolPermissionConfig,
};

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;

pub struct SidecarState {
    pub port: Mutex<Option<u16>>,
    pub token: Mutex<Option<String>>,
    pub child: Mutex<Option<CommandChild>>,
    /// Bumped on every spawn so a dying sidecar's reader task can't clobber a newer one.
    pub generation: AtomicU64,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            port: Mutex::new(None),
            token: Mutex::new(None),
            child: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }
}

#[tauri::command]
fn get_sidecar_info(state: tauri::State<SidecarState>) -> Option<sidecar::SidecarInfo> {
    tauri_debug!("tauri", "cmd:get_sidecar_info");
    let port = (*state.port.lock().unwrap())?;
    let token = (*state.token.lock().unwrap()).clone()?;
    Some(sidecar::SidecarInfo { port, token })
}

#[tauri::command]
async fn restart_sidecar(app: tauri::AppHandle) -> Result<u16, String> {
    // Take the old child out of the lock BEFORE awaiting, then kill it.
    let old = app.state::<SidecarState>().child.lock().unwrap().take();
    if let Some(child) = old {
        let _ = child.kill();
    }
    *app.state::<SidecarState>().port.lock().unwrap() = None;
    *app.state::<SidecarState>().token.lock().unwrap() = None;

    // spawn_sidecar stores the fresh token internally and returns the port.
    let port = sidecar::spawn_sidecar(&app).await?;
    *app.state::<SidecarState>().port.lock().unwrap() = Some(port);
    Ok(port)
}

#[tauri::command]
fn get_hip_config(app: tauri::AppHandle) -> Result<String, String> {
    let path = paths::hip_config_path(&app).ok_or("no config dir")?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let toml_cfg: TomlHipConfig =
                toml::from_str(&raw).map_err(|e| format!("TOML parse error: {e}"))?;
            let cfg: HipConfig = toml_cfg.into();
            serde_json::to_string(&cfg).map_err(|e| e.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // No TOML yet -> return an empty default. Legacy JSON files are no longer read.
            let cfg = HipConfig {
                version: 1,
                providers: vec![],
                active_model: None,
                mcp_servers: vec![],
                skills: vec![],
                agents: vec![],
                fixed_agents: None,
                permissions: None,
                agent_loop: None,
                terminal: None,
                code_block: None,
                knowledge: None,
                window: None,
                acp: None,
                plan: None,
                voice: None,
            proxy: None,
            };
            serde_json::to_string(&cfg).map_err(|e| e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_hip_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let cfg: HipConfig =
        serde_json::from_str(&json).map_err(|e| format!("JSON parse error: {e}"))?;
    let toml_cfg: TomlHipConfig = cfg.into();
    let toml_str =
        toml::to_string_pretty(&toml_cfg).map_err(|e| format!("TOML serialize error: {e}"))?;
    let path = paths::hip_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&path, toml_str).map_err(|e| e.to_string())
}

fn read_network_policy(path: &std::path::Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_network_policy(path: &std::path::Path, json: &str) -> Result<(), String> {
    let cfg: NetworkPolicyConfig =
        serde_json::from_str(json).map_err(|e| format!("JSON parse error: {e}"))?;
    let pretty =
        serde_json::to_string_pretty(&cfg).map_err(|e| format!("JSON serialize error: {e}"))?;
    std::fs::write(path, pretty).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_network_policy(app: tauri::AppHandle) -> Result<String, String> {
    let path = paths::network_policy_path(&app).ok_or("no config dir")?;
    read_network_policy(&path)
}

#[tauri::command]
fn set_network_policy(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = paths::network_policy_path(&app).ok_or("no config dir")?;
    write_network_policy(&path, &json)
}

/// Path to the file-backed secret store (`~/.hip/config/auth.json`).
fn auth_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    paths::auth_json_path(app).ok_or_else(|| "no config dir".to_string())
}

/// Internal reader used by the sidecar spawn path.
pub fn get_secret_value(app: &tauri::AppHandle, key: &str) -> Option<String> {
    auth::auth_get(&auth_path(app).ok()?, key)
}

#[tauri::command]
fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    auth::auth_set(&auth_path(&app)?, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    // Defense in depth (K6b): never expose SSH passwords/passphrases to the renderer.
    // Internal `get_secret_value` still loads them for `ssh_open` only.
    if key.starts_with("hip.ssh.") {
        return Err("SSH secrets cannot be read from the renderer".into());
    }
    Ok(auth::auth_get(&auth_path(&app)?, &key))
}

#[tauri::command]
fn has_secrets(app: tauri::AppHandle, keys: Vec<String>) -> Result<HashMap<String, bool>, String> {
    let auth_map = auth::auth_get_all(&auth_path(&app)?);
    let mut result = HashMap::new();
    for key in &keys {
        let env_key = sidecar::provider_key_env(key);
        // Non-empty string only — parity with has_secret_keys / auth_has_nonempty.
        result.insert(key.clone(), auth::auth_has_nonempty(&auth_map, &env_key));
    }
    Ok(result)
}

/// Raw key presence (no `provider_key_env` mapping). Order matches input `keys`.
/// Non-empty string values only (empty string → false). Used for SSH secrets
/// (`hip.ssh.<hostId>.*`) and other non-provider auth.json keys.
#[tauri::command]
fn has_secret_keys(app: tauri::AppHandle, keys: Vec<String>) -> Result<Vec<bool>, String> {
    let auth_map = auth::auth_get_all(&auth_path(&app)?);
    Ok(keys
        .iter()
        .map(|k| auth::auth_has_nonempty(&auth_map, k))
        .collect())
}

#[tauri::command]
fn delete_secret(app: tauri::AppHandle, key: String) -> Result<(), String> {
    auth::auth_delete(&auth_path(&app)?, &key).map_err(|e| e.to_string())
}

const MODELS_URL: &str = "https://models.dev/api.json";
/// Bundled fallback when no on-disk cache exists yet (first launch / wiped cache).
const SNAPSHOT: &str = include_str!("../resources/models-snapshot.json");


#[tauri::command]
fn get_plugins_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::plugins_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_else(|_| r#"{"plugins":[],"entries":[]}"#.to_string())),
        None => Ok(r#"{"plugins":[],"entries":[]}"#.to_string()),
    }
}

#[tauri::command]
fn set_plugins_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::plugins_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_plugins(app: tauri::AppHandle) -> Result<String, String> {
    let dir = paths::plugins_dir(&app).ok_or("no plugins dir")?;
    let config = paths::plugins_config_path(&app);
    let metas = plugins::list_installed_plugins(&dir, config.as_deref());
    serde_json::to_string(&metas).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_marketplace_sources(app: tauri::AppHandle) -> Result<String, String> {
    let sources = marketplace::list_sources(&app)?;
    serde_json::to_string(&sources).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_marketplace_source_enabled(
    app: tauri::AppHandle,
    source_id: String,
    enabled: bool,
) -> Result<(), String> {
    marketplace::set_source_enabled(&app, &source_id, enabled)
}

#[tauri::command]
async fn refresh_marketplace_catalog(
    app: tauri::AppHandle,
    source_id: Option<String>,
) -> Result<(), String> {
    marketplace::refresh_catalog(&app, source_id.as_deref()).await
}

#[tauri::command]
fn list_marketplace_plugins(app: tauri::AppHandle) -> Result<String, String> {
    let snap = marketplace::list_marketplace_snapshot(&app)?;
    serde_json::to_string(&snap).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_marketplace_source(
    app: tauri::AppHandle,
    git_url: String,
) -> Result<String, String> {
    let src = marketplace::add_source(&app, &git_url).await?;
    serde_json::to_string(&src).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_marketplace_source(app: tauri::AppHandle, source_id: String) -> Result<(), String> {
    marketplace::remove_source(&app, &source_id)
}

#[tauri::command]
fn list_mcp_registry_sources(app: tauri::AppHandle) -> Result<String, String> {
    let sources = mcp_registry::list_sources(&app)?;
    serde_json::to_string(&sources).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mcp_registry_source_enabled(
    app: tauri::AppHandle,
    source_id: String,
    enabled: bool,
) -> Result<(), String> {
    mcp_registry::set_source_enabled(&app, &source_id, enabled)
}

#[tauri::command]
async fn refresh_mcp_registry_catalog(
    app: tauri::AppHandle,
    source_id: Option<String>,
) -> Result<(), String> {
    mcp_registry::refresh_catalog(&app, source_id.as_deref()).await
}

#[tauri::command]
fn list_mcp_registry_servers(app: tauri::AppHandle) -> Result<String, String> {
    let snap = mcp_registry::list_snapshot(&app)?;
    serde_json::to_string(&snap).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_mcp_registry_source(
    app: tauri::AppHandle,
    registry_url: String,
) -> Result<String, String> {
    let src = mcp_registry::add_source(&app, &registry_url).await?;
    serde_json::to_string(&src).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_mcp_registry_source(app: tauri::AppHandle, source_id: String) -> Result<(), String> {
    mcp_registry::remove_source(&app, &source_id)
}

#[tauri::command]
fn set_plugin_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 plugin id".to_string());
    }
    let plugin_dir = paths::plugins_dir(&app)
        .ok_or("no plugins dir")?
        .join(&id);
    // Prefer registered absolute path when the plugin lives outside the default root.
    let config_path = paths::plugins_config_path(&app).ok_or("no config dir")?;
    let dir = if plugin_dir.is_dir() {
        plugin_dir
    } else {
        let metas = plugins::list_installed_plugins(
            paths::plugins_dir(&app).as_ref().ok_or("no plugins dir")?,
            Some(&config_path),
        );
        metas
            .into_iter()
            .find(|m| m.id == id)
            .map(|m| std::path::PathBuf::from(m.dir))
            .ok_or_else(|| "plugin 不存在".to_string())?
    };
    plugins::set_plugin_enabled(&config_path, &id, enabled, &dir)
}

#[tauri::command]
fn read_plugin_file(app: tauri::AppHandle, id: String, rel: String) -> Result<String, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 plugin id".to_string());
    }
    let config = paths::plugins_config_path(&app);
    let root = paths::plugins_dir(&app).ok_or("no plugins dir")?;
    let metas = plugins::list_installed_plugins(&root, config.as_deref());
    let meta = metas
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| "plugin 不存在".to_string())?;
    plugins::read_plugin_file(std::path::Path::new(&meta.dir), &rel)
}

#[tauri::command]
fn install_plugin(app: tauri::AppHandle, zip_path: String) -> Result<String, String> {
    let plugins_root = paths::plugins_dir(&app).ok_or("no plugins dir")?;
    let staging = plugins_root.join(format!(".staging-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let cleanup = |dir: &std::path::Path| {
        let _ = std::fs::remove_dir_all(dir);
    };

    if let Err(e) = skills::extract_zip(std::path::Path::new(&zip_path), &staging) {
        cleanup(&staging);
        return Err(format!("解压失败: {e}"));
    }
    let root = match plugins::find_plugin_root(&staging) {
        Some(r) => r,
        None => {
            cleanup(&staging);
            return Err("压缩包内未找到 .plugin/plugin.json".to_string());
        }
    };
    let manifest_path = root.join(".plugin").join("plugin.json");
    let body = match std::fs::read_to_string(&manifest_path) {
        Ok(b) => b,
        Err(e) => {
            cleanup(&staging);
            return Err(e.to_string());
        }
    };
    let manifest: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("plugin.json 解析失败: {e}"))?;
    let name = manifest
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .ok_or("plugin.json 缺少 name 字段".to_string())?;

    let base = plugins::slugify_plugin(name);
    let mut slug = base.clone();
    let mut n = 2;
    while plugins_root.join(&slug).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    let final_dir = plugins_root.join(&slug);
    if let Err(e) = std::fs::rename(&root, &final_dir) {
        cleanup(&staging);
        return Err(format!("安装失败: {e}"));
    }
    cleanup(&staging);

    // Register in hip-plugins.json
    if let Some(config_path) = paths::plugins_config_path(&app) {
        plugins::register_plugin(&config_path, &final_dir)?;
    }

    Ok(slug)
}

#[tauri::command]
fn delete_plugin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 plugin id".to_string());
    }
    let dir = paths::plugins_dir(&app).ok_or("no plugins dir")?.join(&id);
    if !dir.is_dir() {
        return Err("plugin 不存在".to_string());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;

    if let Some(config_path) = paths::plugins_config_path(&app) {
        plugins::unregister_plugin(&config_path, &id)?;
    }
    Ok(())
}

#[tauri::command]
fn list_skills(app: tauri::AppHandle, project_root: Option<String>) -> Result<String, String> {
    let proj = project_root
        .as_deref()
        .map(std::path::Path::new);
    let metas = skills::scan_skills(&app, proj);
    serde_json::to_string(&metas).map_err(|e| e.to_string())
}

#[tauri::command]
fn install_skill_zip(app: tauri::AppHandle, zip_path: String) -> Result<String, String> {
    let skills_root = paths::skills_dir(&app).ok_or("no skills dir")?;
    // Stage into a temp dir under the skills root so a half-extracted bundle never
    // pollutes the live list; promote to <root>/<slug> only after validation.
    let staging = skills_root.join(format!(".staging-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let cleanup = |dir: &std::path::Path| {
        let _ = std::fs::remove_dir_all(dir);
    };

    if let Err(e) = skills::extract_zip(std::path::Path::new(&zip_path), &staging) {
        cleanup(&staging);
        return Err(format!("解压失败: {e}"));
    }
    let root = match skills::find_skill_root(&staging) {
        Some(r) => r,
        None => {
            cleanup(&staging);
            return Err("压缩包内未找到 SKILL.md".to_string());
        }
    };
    let body = match std::fs::read_to_string(root.join("SKILL.md")) {
        Ok(b) => b,
        Err(e) => {
            cleanup(&staging);
            return Err(e.to_string());
        }
    };
    let name = match skills::parse_frontmatter(&body).and_then(|f| f.name) {
        Some(n) if !n.trim().is_empty() => n,
        _ => {
            cleanup(&staging);
            return Err("SKILL.md 缺少 name 字段".to_string());
        }
    };

    // Derive a unique slug under the skills root.
    let base = skills::slugify(&name);
    let mut slug = base.clone();
    let mut n = 2;
    while skills_root.join(&slug).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    let final_dir = skills_root.join(&slug);
    if let Err(e) = std::fs::rename(&root, &final_dir) {
        cleanup(&staging);
        return Err(format!("安装失败: {e}"));
    }
    cleanup(&staging);
    Ok(slug)
}

#[tauri::command]
fn delete_skill(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Guard against path traversal in the id — it must be a single dir name.
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 skill id".to_string());
    }
    // Never delete product built-ins under ~/.hip/builtin-skills.
    if let Some(builtin) = paths::builtin_skills_dir(&app) {
        let builtin_dir = builtin.join(&id);
        if builtin_dir.is_dir() {
            // Only refuse when there is no user override under skills/; otherwise
            // delete removes the user copy and the built-in remains.
            let user = paths::skills_dir(&app).map(|d| d.join(&id)).filter(|d| d.is_dir());
            if user.is_none() {
                return Err("内置 skill 不可删除".to_string());
            }
        }
    }
    let dir = paths::skills_dir(&app).ok_or("no skills dir")?.join(&id);
    if !dir.is_dir() {
        return Err("skill 不存在".to_string());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_skill_file(app: tauri::AppHandle, id: String, rel: String) -> Result<String, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 skill id".to_string());
    }
    let standalone_dir = paths::skills_dir(&app)
        .map(|d| d.join(&id))
        .filter(|d| d.is_dir());
    let skill_dir = match standalone_dir {
        Some(d) => d,
        None => {
            let builtin_dir = paths::builtin_skills_dir(&app)
                .map(|d| d.join(&id))
                .filter(|d| d.is_dir());
            match builtin_dir {
                Some(d) => d,
                None => {
                    let plugins_dir = paths::plugins_dir(&app).ok_or("no plugin dir")?;
                    skills::find_plugin_skill_dir(&plugins_dir, &id).ok_or("skill not found")?
                }
            }
        }
    };
    let target = skills::safe_join(&skill_dir, &rel).ok_or("非法文件路径")?;
    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

fn catalog_cache_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    paths::cache_dir(app).map(|d| d.join("models.json"))
}

/// Local-only catalog: disk cache if present, else the bundled snapshot.
/// Never hits the network — keeps app startup / LoadingScreen instant (SWR).
fn read_local_catalog(app: &tauri::AppHandle) -> String {
    if let Some(c) = catalog_cache_path(app) {
        if let Ok(body) = std::fs::read_to_string(&c) {
            if !body.trim().is_empty() {
                return body;
            }
        }
    }
    SNAPSHOT.to_string()
}

/// Reject non-JSON / non-object bodies so we never poison `models.json` with HTML error pages.
fn validate_catalog_json(body: &str) -> Result<(), String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid catalog json: {e}"))?;
    if !v.is_object() {
        return Err("catalog root must be a JSON object".into());
    }
    Ok(())
}

fn write_catalog_cache(path: &std::path::Path, body: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Force-fetch models.dev (or `HIP_MODELS_URL`), validate, write cache, return body.
/// Used for background revalidation on every app open — does not fall back to cache on failure
/// (callers already have local catalog); returns Err so the UI can keep the previous catalog.
async fn download_catalog(app: &tauri::AppHandle) -> Result<String, String> {
    let url = std::env::var("HIP_MODELS_URL").unwrap_or_else(|_| MODELS_URL.to_string());
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("catalog fetch failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("catalog HTTP error: {e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("catalog body read failed: {e}"))?;
    validate_catalog_json(&body)?;
    if let Some(c) = catalog_cache_path(app) {
        write_catalog_cache(&c, &body)?;
    }
    Ok(body)
}

/// Write UTF-8 text to an absolute path chosen by the user (e.g. save dialog).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let dest = std::path::PathBuf::from(&path);
    if !dest.is_absolute() {
        return Err("path must be absolute".into());
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&dest, contents).map_err(|e| e.to_string())
}

/// Union of alive PTY + SSH ids for UI badges / soft-cap pre-check.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InteractiveTerminalEntry {
    id: String,
    kind: String, // "pty" | "ssh"
}

#[tauri::command]
fn interactive_terminal_list(
    pty: tauri::State<'_, pty::PtyManager>,
    manager: tauri::State<'_, ssh_session::SshManager>,
) -> Result<Vec<InteractiveTerminalEntry>, String> {
    let mut out = Vec::new();
    for id in pty.list_alive_ids() {
        out.push(InteractiveTerminalEntry {
            id,
            kind: "pty".into(),
        });
    }
    for id in manager.list_alive_ids() {
        out.push(InteractiveTerminalEntry {
            id,
            kind: "ssh".into(),
        });
    }
    Ok(out)
}

/// Instant catalog for UI boot: cache or bundled snapshot only (no network).
#[tauri::command]
fn models_catalog(app: tauri::AppHandle) -> Result<String, String> {
    Ok(read_local_catalog(&app))
}

/// Force network refresh of the models.dev catalog and update on-disk cache.
/// Intended for every app open (stale-while-revalidate); UI keeps serving local until this returns.
#[tauri::command]
async fn models_catalog_refresh(app: tauri::AppHandle) -> Result<String, String> {
    download_catalog(&app).await
}

/// True when either window dimension exceeds the monitor work area (physical pixels).
/// "Partially too large" → maximize instead of leaving a clipped/off-screen window.
fn window_size_exceeds_work_area(window: (u32, u32), work_area: (u32, u32)) -> bool {
    window.0 > work_area.0 || window.1 > work_area.1
}

/// If the main window's outer size exceeds the current (or primary) monitor work area,
/// maximize it. Best-effort: failures are logged and ignored so boot continues.
fn maximize_if_window_exceeds_monitor(window: &tauri::WebviewWindow) {
    let Ok(outer) = window.outer_size() else {
        return;
    };
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => m,
        _ => match window.primary_monitor() {
            Ok(Some(m)) => m,
            _ => return,
        },
    };
    let work = monitor.work_area().size;
    if !window_size_exceeds_work_area(
        (outer.width, outer.height),
        (work.width, work.height),
    ) {
        return;
    }
    match window.maximize() {
        Ok(()) => {
            println!(
                "[tauri] window {}x{} exceeds work area {}x{}; maximized",
                outer.width, outer.height, work.width, work.height
            );
        }
        Err(e) => {
            eprintln!("[tauri] maximize after oversized window failed: {e}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A GUI/IDE-launched macOS app inherits a stripped PATH; resolve the user's real
    // global PATH first so detection (path_tools::which_binaries), the sidecar, and every spawned
    // ACP/CLI agent can find globally-installed tools.
    path_env::ensure_user_path();

    // Release builds: second launch focuses the existing window. Dev keeps multi-instance
    // (and HIP_ALLOW_MULTI_INSTANCE=1 always allows multi-instance).
    #[cfg_attr(debug_assertions, allow(unused_mut))]
    use tauri_plugin_autostart::MacosLauncher;

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_wdio_webdriver::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(SidecarState::new())
        .manage(terminal_budget::TerminalBudget::new())
        .manage(pty::PtyManager::new())
        .manage(window_tray::WindowPolicyState(std::sync::Mutex::new(
            window_tray::WindowPolicy::default(),
        )))
        .manage(window_tray::TrayState(std::sync::Mutex::new(None)))
        .manage(window_tray::TrayLabelsState(std::sync::Mutex::new(
            window_tray::TrayLabels::default(),
        )))
        .manage(window_tray::QuitGuard::default());

    #[cfg(not(debug_assertions))]
    {
        if std::env::var_os("HIP_ALLOW_MULTI_INSTANCE").is_none() {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                window_tray::show_main_window(app);
            }));
        }
    }

    let app = builder
        .manage(ssh_session::SshManager::new())
        .manage(sftp::SftpTransferState::new())
        .setup(|app| {
            // Ensure hip-plugins.json exists with a valid default so that the plugin
            // registry is always a well-known file (even if empty). Normalize legacy
            // object entries (dir/path) to string paths on every startup.
            if let Some(plugins_path) = paths::plugins_config_path(&app.handle()) {
                if !plugins_path.exists() {
                    let default = r#"{"plugins":[],"entries":[]}"#;
                    if let Err(e) = std::fs::write(&plugins_path, default) {
                        eprintln!("[tauri] could not create {0}: {e}", plugins_path.display());
                    } else {
                        println!("[tauri] created default plugin registry at {0}", plugins_path.display());
                    }
                } else {
                    let _ = plugins::normalize_plugins_config_file(&plugins_path);
                }
            }
            // Load [window] close/tray policy and install tray when enabled.
            {
                let policy = window_tray::load_policy_from_disk(app.handle());
                if let Ok(mut slot) = app.state::<window_tray::WindowPolicyState>().0.lock() {
                    *slot = policy;
                }
                window_tray::sync_tray(app.handle());
                window_tray::maybe_start_hidden(app.handle());
            }
            // Configured size (tauri.conf) may exceed this host's display — maximize instead.
            if let Some(window) = app.get_webview_window("main") {
                // Skip maximize when intentionally starting hidden (login item).
                let visible = window.is_visible().unwrap_or(true);
                if visible {
                    maximize_if_window_exceeds_monitor(&window);
                }
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn_sidecar(&handle).await {
                    Ok(port) => {
                        *handle.state::<SidecarState>().port.lock().unwrap() = Some(port);
                        println!("[tauri] sidecar ready on port {port}");
                    }
                    Err(e) => eprintln!("[tauri] sidecar failed: {e}"),
                }
            });
            // Background catalog revalidation (SWR): local cache already serves the UI;
            // this warms/refreshes ~/.hip/cache/models.json for the next read and for any
            // concurrent frontend refreshCatalog call.
            let handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match download_catalog(&handle2).await {
                    Ok(_) => println!("[tauri] models catalog refreshed"),
                    Err(e) => eprintln!("[tauri] models catalog refresh failed: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
            restart_sidecar,
            set_secret,
            get_secret,
            has_secrets,
            has_secret_keys,
            delete_secret,
            window_tray::window_get_policy,
            window_tray::window_set_policy,
            window_tray::window_close_decision,
            window_tray::window_show_main,
            window_tray::window_hide_main,
            window_tray::window_quit,
            window_tray::window_force_quit,
            window_tray::window_cancel_exit,
            window_tray::window_exit_hide_instead,
            window_tray::window_is_main_visible,
            window_tray::window_set_launch_at_login,
            window_tray::window_get_launch_at_login,
            window_tray::tray_set_status,
            window_tray::tray_set_labels,
            terminal_hosts::terminal_hosts_list,
            terminal_hosts::terminal_hosts_save,
            work_items::work_items_list,
            work_items::work_items_save,
            work_items_ui_prefs::work_items_list_ui_prefs,
            work_items_ui_prefs::work_items_save_ui_prefs,
            automations::automations_list,
            automations::automations_save,
            automations::automation_runs_list,
            automations::automation_runs_save,
            automations_trash::automations_soft_delete,
            automations_trash::automations_list_trash,
            automations_trash::automations_restore_trash_entry,
            automations_trash::automations_hard_delete_trash_entry,
            automations_trash::automations_empty_trash,
            automations_trash::automations_purge_expired_trash,
            work_items_trash::work_items_soft_delete,
            work_items_trash::work_items_list_trash,
            work_items_trash::work_items_restore_trash_entry,
            work_items_trash::work_items_hard_delete_trash_entry,
            work_items_trash::work_items_empty_trash,
            work_items_trash::work_items_purge_expired_trash,
            models_catalog,
            models_catalog_refresh,
            get_hip_config,
            set_hip_config,
            get_network_policy,
            set_network_policy,
            list_skills,
            install_skill_zip,
            delete_skill,
            read_skill_file,
            get_plugins_config,
            set_plugins_config,
            list_plugins,
            install_plugin,
            delete_plugin,
            set_plugin_enabled,
            read_plugin_file,
            list_marketplace_sources,
            set_marketplace_source_enabled,
            refresh_marketplace_catalog,
            list_marketplace_plugins,
            add_marketplace_source,
            remove_marketplace_source,
            list_mcp_registry_sources,
            set_mcp_registry_source_enabled,
            refresh_mcp_registry_catalog,
            list_mcp_registry_servers,
            add_mcp_registry_source,
            remove_mcp_registry_source,
            path_tools::which_binaries,
            path_tools::path_is_dir,
            workspace_file_search::workspace_file_search,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            term_fs::term_fs_ls,
            ssh_known_hosts::ssh_known_hosts_get,
            ssh_known_hosts::ssh_trust_host,
            ssh_known_hosts::ssh_remove_host_key,
            interactive_terminal_list,
            ssh_session::ssh_open,
            ssh_session::ssh_write,
            ssh_session::ssh_resize,
            ssh_session::ssh_close,
            ssh_session::ssh_list,
            sftp::sftp_ls,
            sftp::sftp_mkdir,
            sftp::sftp_read_file,
            sftp::sftp_write_file,
            sftp::sftp_remove,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::sftp_cancel,
            knowledge::knowledge_ensure_root,
            knowledge::knowledge_list_spaces,
            knowledge::knowledge_create_space,
            knowledge::knowledge_update_space,
            knowledge::knowledge_delete_space,
            knowledge_trash::knowledge_soft_delete_space,
            knowledge_trash::knowledge_soft_delete_nodes,
            knowledge_trash::knowledge_list_trash,
            knowledge_trash::knowledge_restore_trash_entry,
            knowledge_trash::knowledge_hard_delete_trash_entry,
            knowledge_trash::knowledge_empty_trash,
            knowledge_trash::knowledge_purge_expired_trash,
            knowledge_trash::knowledge_reconcile_trash,
            knowledge::knowledge_get_tree,
            knowledge::knowledge_save_tree,
            knowledge::knowledge_read_doc,
            knowledge::knowledge_write_doc,
            knowledge::knowledge_delete_doc_file,
            knowledge::knowledge_export_bytes,
            knowledge::knowledge_save_version,
            knowledge::knowledge_list_versions,
            knowledge::knowledge_read_version,
            knowledge::knowledge_restore_version,
            write_text_file,
            knowledge::knowledge_export_doc,
            knowledge::knowledge_export_text,
            knowledge::knowledge_export_space_zip,
            knowledge::knowledge_import_folder,
            knowledge::knowledge_reveal_doc,
            knowledge::knowledge_import_asset_from_path,
            knowledge::knowledge_import_asset_bytes,
            knowledge::knowledge_read_asset_data,
            knowledge::knowledge_asset_abs_path,
            knowledge::knowledge_reveal_path,
            knowledge::knowledge_list_templates,
            knowledge::knowledge_save_template,
            knowledge::knowledge_delete_template,
            knowledge_link_index::knowledge_link_index_upsert,
            knowledge_link_index::knowledge_link_index_remove_doc,
            knowledge_link_index::knowledge_link_index_replace_all,
            knowledge_link_index::knowledge_link_index_backlinks,
            knowledge_link_index::knowledge_link_index_outbound,
            knowledge_link_index::knowledge_link_index_broken,
            knowledge_link_index::knowledge_link_index_doc_count,
            knowledge_link_index::knowledge_link_index_graph,
            voice::voice_runtime_status,
            voice::voice_model_status,
            voice::voice_download_model,
            voice::voice_cancel_download,
            voice::voice_transcribe,
            voice::voice_open_models_dir,
            provider_logo::provider_logo,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| match event {
        // Graceful quit (Cmd+Q / AppHandle::exit): kill the managed sidecar + PTYs.
        // NOTE: this fires ONLY for GUI/programmatic exits — a SIGTERM/SIGKILL to
        // this process (e.g. E2E teardown) runs no handler, so the sidecar also
        // self-terminates when our stdin pipe closes (HIP_PARENT_WATCH; sidecar.rs).
        // Interactive shells have no parent-death watchdog (accepted; design D orphan policy).
        tauri::RunEvent::ExitRequested { api, .. } => {
            // Phase 2: unless force_quit, let FE confirm when agents/tasks may be running.
            if !window_tray::handle_exit_requested(app_handle, &api) {
                return;
            }
            if let Some(child) = app_handle.state::<SidecarState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
            // Product CLI discovery file must not outlive the host.
            crate::sidecar::remove_discovery_file(app_handle);
            let budget = app_handle.state::<terminal_budget::TerminalBudget>();
            app_handle.state::<pty::PtyManager>().kill_all(&budget);
            app_handle
                .state::<ssh_session::SshManager>()
                .kill_all(&budget);
        }
        // Close chrome: hide to tray when policy says so; otherwise quit (historical default).
        // exit() routes through ExitRequested above for sidecar / PTY / SSH cleanup.
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            window_tray::handle_close_requested(app_handle, api);
        }
        // macOS Dock click when all windows are hidden → restore main window.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                window_tray::show_main_window(app_handle);
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn window_size_exceeds_work_area_partial_or_full() {
        // Fits exactly / smaller
        assert!(!super::window_size_exceeds_work_area((1800, 1100), (1920, 1200)));
        assert!(!super::window_size_exceeds_work_area((1920, 1080), (1920, 1080)));
        // Width only
        assert!(super::window_size_exceeds_work_area((2000, 900), (1920, 1080)));
        // Height only
        assert!(super::window_size_exceeds_work_area((1600, 1200), (1920, 1080)));
        // Both
        assert!(super::window_size_exceeds_work_area((2560, 1600), (1920, 1080)));
    }

    #[test]
    fn find_on_path_detects_executables() {
        let dir = std::env::temp_dir().join(format!("hip-which-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("opencode");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let names = vec!["opencode".to_string(), "nope".to_string()];
        let got = super::path_tools::find_on_path(&names, &[PathBuf::from(&dir)]);
        assert_eq!(got.get("opencode"), Some(&true));
        assert_eq!(got.get("nope"), Some(&false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn find_on_path_rejects_non_executable_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("hip-which-noexec-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("opencode");
        std::fs::write(&f, "not executable\n").unwrap();
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        let got = super::path_tools::find_on_path(&["opencode".to_string()], &[std::path::PathBuf::from(&dir)]);
        assert_eq!(got.get("opencode"), Some(&false));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── HipConfig TOML roundtrip tests ──

    fn sample_config() -> super::HipConfig {
        super::HipConfig {
            version: 1,
            providers: vec![super::ProviderEntry {
                id: "openai".into(),
                name: "OpenAI".into(),
                base_url: "https://api.openai.com/v1".into(),
                api_key: Some("sk-abc".into()),
                enabled: true,
            }],
            active_model: None,
            mcp_servers: vec![super::McpServerEntry {
                id: "srv-1".into(),
                name: "Local".into(),
                transport: "stdio".into(),
                command: Some("npx".into()),
                args: vec![],
                env: None,
                url: None,
                headers: None,
                enabled_tools: None,
                disabled_tools: None,
                enabled: true,
                registry_name: None,
                registry_source_id: None,
                registry_version: None,
            }],
            skills: vec![super::SkillEntry { id: "pdf-tools".into(), enabled: true }],
            agents: vec![super::AgentEntry {
                id: "helper".into(),
                name: "Helper".into(),
                description: None,
                kind: "internal".into(),
                command: "".into(),
                args: vec![],
                bound_model: None,
                quirks: None,
                env: None,
                prompt: Some("You help.".into()),
                allowed_tools: None,
                allowed_skills: None,
                allowed_mcp_servers: None,
                enabled: true,
            }],
            fixed_agents: None,
            permissions: Some(super::PermissionEntry {
                coarse_mode: "edit".into(),
                tool_permissions: None,
            }),
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        }
    }

    #[test]
    fn toml_roundtrip_preserves_all_sections() {
        let cfg = sample_config();

        let toml_cfg: super::TomlHipConfig = cfg.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(toml_str.contains("mcp_servers"), "TOML should use snake_case keys");
        assert!(!toml_str.contains("mcpServers"), "TOML should not contain camelCase keys");
        let from_toml_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let from_toml: super::HipConfig = from_toml_toml.into();

        assert_eq!(from_toml.version, 1);
        assert_eq!(from_toml.providers.len(), 1);
        assert_eq!(from_toml.providers[0].id, "openai");
        assert_eq!(from_toml.providers[0].api_key.as_deref(), Some("sk-abc"));
        assert_eq!(from_toml.mcp_servers.len(), 1);
        assert_eq!(from_toml.mcp_servers[0].id, "srv-1");
        assert_eq!(from_toml.mcp_servers[0].transport, "stdio");
        assert_eq!(from_toml.skills.len(), 1);
        assert_eq!(from_toml.skills[0].id, "pdf-tools");
        assert!(from_toml.skills[0].enabled);
        assert_eq!(from_toml.agents.len(), 1);
        assert_eq!(from_toml.agents[0].id, "helper");
        assert_eq!(from_toml.agents[0].prompt.as_deref(), Some("You help."));
        assert_eq!(
            from_toml.permissions.as_ref().unwrap().coarse_mode,
            "edit"
        );
    }

    #[test]
    fn json_to_toml_to_json_roundtrip() {
        let cfg = sample_config();

        let json = serde_json::to_string(&cfg).unwrap();
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(from_json.providers[0].id, "openai");

        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(toml_str.contains("mcp_servers"), "TOML should use snake_case keys");
        assert!(!toml_str.contains("mcpServers"), "TOML should not contain camelCase keys");
        let from_toml_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let from_toml: super::HipConfig = from_toml_toml.into();

        let json2 = serde_json::to_string(&from_toml).unwrap();
        let from_json2: super::HipConfig = serde_json::from_str(&json2).unwrap();
        assert_eq!(from_json2.version, 1);
        assert_eq!(from_json2.mcp_servers[0].id, "srv-1");
    }

    #[test]
    fn frontend_active_model_and_bound_model_json_keys_roundtrip() {
        // The renderer (protocol) emits capital-ID/URL keys: providerID / modelID / baseURL.
        // set_hip_config does serde_json::from_str::<HipConfig>, so these MUST parse; and
        // get_hip_config serializes back, so the same keys MUST be emitted for the renderer to read.
        let json = r#"{
            "version": 1,
            "activeModel": { "providerID": "deepseek", "modelID": "deepseek-v4", "baseURL": "https://api.deepseek.com/v1" },
            "agents": [
                { "id": "coder", "name": "Coder", "kind": "internal", "command": "", "args": [], "enabled": true,
                  "boundModel": { "providerID": "openai", "modelID": "gpt-4o" } }
            ]
        }"#;

        let cfg: super::HipConfig =
            serde_json::from_str(json).expect("renderer-shaped activeModel/boundModel JSON must parse");

        let am = cfg.active_model.as_ref().expect("activeModel present");
        assert_eq!(am.provider_id, "deepseek");
        assert_eq!(am.model_id, "deepseek-v4");
        assert_eq!(am.base_url, "https://api.deepseek.com/v1");
        let bm = cfg.agents[0].bound_model.as_ref().expect("boundModel present");
        assert_eq!(bm.provider_id, "openai");
        assert_eq!(bm.model_id, "gpt-4o");

        // Read path: serialize back with the SAME protocol keys the renderer reads.
        let out = serde_json::to_string(&cfg).unwrap();
        assert!(out.contains("\"providerID\""), "must emit providerID, got: {out}");
        assert!(out.contains("\"modelID\""), "must emit modelID, got: {out}");
        assert!(out.contains("\"baseURL\""), "must emit baseURL, got: {out}");
        assert!(!out.contains("\"providerId\""), "must NOT emit camelCase providerId, got: {out}");
    }

    #[test]
    fn toml_roundtrip_preserves_all_fields() {
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![
                super::ProviderEntry {
                    id: "openai".into(),
                    name: "OpenAI".into(),
                    base_url: "https://api.openai.com/v1".into(),
                    api_key: Some("sk-openai".into()),
                    enabled: true,
                },
                super::ProviderEntry {
                    id: "anthropic".into(),
                    name: "Anthropic".into(),
                    base_url: "https://api.anthropic.com".into(),
                    api_key: Some("sk-ant".into()),
                    enabled: true,
                },
            ],
            active_model: None,
            agents: vec![
                super::AgentEntry {
                    id: "assistant".into(),
                    name: "Assistant".into(),
                    description: None,
                    kind: "internal".into(),
                    command: "".into(),
                    args: vec![],
                    bound_model: None,
                    quirks: None,
                    env: None,
                    prompt: Some("You are a helpful assistant.".into()),
                    allowed_tools: None,
                    allowed_skills: None,
                    allowed_mcp_servers: None,
                    enabled: true,
                },
                super::AgentEntry {
                    id: "coder".into(),
                    name: "Coder".into(),
                    description: None,
                    kind: "external".into(),
                    command: "codex".into(),
                    args: vec!["--model".into(), "gpt-5".into()],
                    bound_model: None,
                    quirks: None,
                    env: None,
                    prompt: Some("Write code.".into()),
                    allowed_tools: None,
                    allowed_skills: None,
                    allowed_mcp_servers: None,
                    enabled: true,
                },
            ],
            mcp_servers: vec![
                super::McpServerEntry {
                    id: "filesystem".into(),
                    name: "Filesystem".into(),
                    transport: "stdio".into(),
                    command: Some("npx".into()),
                    args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into()],
                    env: None,
                    url: None,
                    headers: None,
                    enabled_tools: None,
                    disabled_tools: None,
                    enabled: true,
                    registry_name: None,
                    registry_source_id: None,
                    registry_version: None,
                },
                super::McpServerEntry {
                    id: "github".into(),
                    name: "GitHub".into(),
                    transport: "stdio".into(),
                    command: Some("npx".into()),
                    args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
                    env: None,
                    url: None,
                    headers: None,
                    enabled_tools: None,
                    disabled_tools: None,
                    enabled: false,
                    registry_name: None,
                    registry_source_id: None,
                    registry_version: None,
                },
            ],
            skills: vec![
                super::SkillEntry { id: "pdf-tools".into(), enabled: true },
                super::SkillEntry { id: "image-gen".into(), enabled: false },
            ],
            fixed_agents: None,
            permissions: Some(super::PermissionEntry {
                coarse_mode: "allow".into(),
                tool_permissions: None,
            }),
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        };

        let toml_str = toml::to_string_pretty(&cfg).unwrap();
        let from_toml: super::HipConfig = toml::from_str(&toml_str).unwrap();

        assert_eq!(from_toml.version, 1);

        assert_eq!(from_toml.providers.len(), 2);
        assert_eq!(from_toml.providers[0].id, "openai");
        assert_eq!(from_toml.providers[0].name, "OpenAI");
        assert_eq!(from_toml.providers[0].base_url, "https://api.openai.com/v1");
        assert_eq!(from_toml.providers[0].api_key.as_deref(), Some("sk-openai"));
        assert_eq!(from_toml.providers[1].id, "anthropic");
        assert_eq!(from_toml.providers[1].name, "Anthropic");
        assert_eq!(from_toml.providers[1].base_url, "https://api.anthropic.com");
        assert_eq!(from_toml.providers[1].api_key.as_deref(), Some("sk-ant"));

        assert_eq!(from_toml.agents.len(), 2);
        assert_eq!(from_toml.agents[0].id, "assistant");
        assert_eq!(from_toml.agents[0].name, "Assistant");
        assert_eq!(from_toml.agents[0].kind, "internal");
        assert_eq!(from_toml.agents[0].command, "");
        assert!(from_toml.agents[0].enabled);
        assert_eq!(from_toml.agents[1].id, "coder");
        assert_eq!(from_toml.agents[1].name, "Coder");
        assert_eq!(from_toml.agents[1].kind, "external");
        assert_eq!(from_toml.agents[1].command, "codex");
        assert!(from_toml.agents[1].enabled);

        assert_eq!(from_toml.mcp_servers.len(), 2);
        assert_eq!(from_toml.mcp_servers[0].id, "filesystem");
        assert_eq!(from_toml.mcp_servers[0].name, "Filesystem");
        assert_eq!(from_toml.mcp_servers[0].transport, "stdio");
        assert!(from_toml.mcp_servers[0].enabled);
        assert_eq!(from_toml.mcp_servers[1].id, "github");
        assert_eq!(from_toml.mcp_servers[1].name, "GitHub");
        assert_eq!(from_toml.mcp_servers[1].transport, "stdio");
        assert!(!from_toml.mcp_servers[1].enabled);

        assert_eq!(from_toml.skills.len(), 2);
        assert_eq!(from_toml.skills[0].id, "pdf-tools");
        assert!(from_toml.skills[0].enabled);
        assert_eq!(from_toml.skills[1].id, "image-gen");
        assert!(!from_toml.skills[1].enabled);

        assert_eq!(
            from_toml.permissions.as_ref().unwrap().coarse_mode,
            "allow"
        );

        let json1 = serde_json::to_string(&cfg).unwrap();
        let from_json: super::HipConfig = serde_json::from_str(&json1).unwrap();
        let toml2 = toml::to_string_pretty(&from_json).unwrap();
        let from_toml2: super::HipConfig = toml::from_str(&toml2).unwrap();
        let json2 = serde_json::to_string(&from_toml2).unwrap();
        assert_eq!(json1, json2);
    }

    #[test]
    fn toml_mirror_roundtrip_preserves_all_fields() {
        let cfg = super::TomlHipConfig {
            version: 1,
            providers: vec![
                super::TomlProviderEntry {
                    id: "openai".into(),
                    name: "OpenAI".into(),
                    base_url: "https://api.openai.com/v1".into(),
                    api_key: Some("sk-test-openai".into()),
                    enabled: true,
                },
                super::TomlProviderEntry {
                    id: "deepseek".into(),
                    name: "DeepSeek".into(),
                    base_url: "https://api.deepseek.com/v1".into(),
                    api_key: Some("sk-test-deepseek".into()),
                    enabled: true,
                },
            ],
            active_model: None,
            mcp_servers: vec![
                super::TomlMcpServerEntry {
                    id: "filesystem".into(),
                    name: "Filesystem".into(),
                    transport: "stdio".into(),
                    command: Some("npx".into()),
                    args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into()],
                    env: None,
                    url: None,
                    headers: None,
                    enabled_tools: Some(vec!["read_file".into(), "write_file".into()]),
                    disabled_tools: None,
                    enabled: true,
                    registry_name: None,
                    registry_source_id: None,
                    registry_version: None,
                },
                super::TomlMcpServerEntry {
                    id: "github".into(),
                    name: "GitHub".into(),
                    transport: "stdio".into(),
                    command: Some("npx".into()),
                    args: vec!["-y".into(), "@modelcontextprotocol/server-github".into()],
                    env: Some({
                        let mut m = std::collections::HashMap::new();
                        m.insert("GITHUB_TOKEN".into(), "ghp-test123".into());
                        m
                    }),
                    url: None,
                    headers: None,
                    enabled_tools: None,
                    disabled_tools: Some(vec!["delete_repo".into()]),
                    enabled: true,
                    registry_name: None,
                    registry_source_id: None,
                    registry_version: None,
                },
            ],
            skills: vec![
                super::TomlSkillEntry { id: "pdf-tools".into(), enabled: true },
                super::TomlSkillEntry { id: "image-gen".into(), enabled: false },
            ],
            agents: vec![
                super::TomlAgentEntry {
                    id: "explorer".into(),
                    name: "Explorer".into(),
                    description: Some("Explores and answers questions about the codebase".into()),
                    kind: "internal".into(),
                    command: "".into(),
                    args: vec![],
                    bound_model: Some(super::TomlBoundModel {
                        provider_id: "deepseek".into(),
                        model_id: "deepseek-chat".into(),
                    }),
                    quirks: None,
                    env: None,
                    prompt: Some("You are a codebase explorer.".into()),
                    allowed_tools: Some(vec!["read".into(), "grep".into(), "glob".into()]),
                    allowed_skills: Some(vec!["ast-grep".into()]),
                    allowed_mcp_servers: Some(vec!["filesystem".into()]),
                    enabled: true,
                },
                super::TomlAgentEntry {
                    id: "coder".into(),
                    name: "Coder".into(),
                    description: None,
                    kind: "external".into(),
                    command: "codex".into(),
                    args: vec!["--model".into(), "gpt-5".into()],
                    bound_model: None,
                    quirks: Some("must-use-yolo-mode".into()),
                    env: Some({
                        let mut m = std::collections::HashMap::new();
                        m.insert("NODE_ENV".into(), "production".into());
                        m
                    }),
                    prompt: None,
                    allowed_tools: None,
                    allowed_skills: None,
                    allowed_mcp_servers: None,
                    enabled: false,
                },
            ],
            fixed_agents: None,
            permissions: Some(super::TomlPermissionEntry {
                coarse_mode: "allow".into(),
                tool_permissions: Some(super::TomlToolPermissionConfig {
                    default_mode: "ask".into(),
                    overrides: Some({
                        let mut m = std::collections::HashMap::new();
                        m.insert("bash".into(), "allow".into());
                        m.insert("write".into(), "deny".into());
                        m
                    }),
                }),
            }),
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        };

        let toml_str = toml::to_string_pretty(&cfg).unwrap();
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();

        assert_eq!(from_toml.version, 1);

        // providers
        assert_eq!(from_toml.providers.len(), 2);
        assert_eq!(from_toml.providers[0].id, "openai");
        assert_eq!(from_toml.providers[0].name, "OpenAI");
        assert_eq!(from_toml.providers[0].base_url, "https://api.openai.com/v1");
        assert_eq!(from_toml.providers[0].api_key.as_deref(), Some("sk-test-openai"));
        assert_eq!(from_toml.providers[1].id, "deepseek");
        assert_eq!(from_toml.providers[1].name, "DeepSeek");
        assert_eq!(from_toml.providers[1].base_url, "https://api.deepseek.com/v1");
        assert_eq!(from_toml.providers[1].api_key.as_deref(), Some("sk-test-deepseek"));

        // mcp_servers
        assert_eq!(from_toml.mcp_servers.len(), 2);
        assert_eq!(from_toml.mcp_servers[0].id, "filesystem");
        assert_eq!(from_toml.mcp_servers[0].name, "Filesystem");
        assert_eq!(from_toml.mcp_servers[0].transport, "stdio");
        assert_eq!(from_toml.mcp_servers[0].command.as_deref(), Some("npx"));
        assert_eq!(
            from_toml.mcp_servers[0].args,
            vec!["-y".to_string(), "@modelcontextprotocol/server-filesystem".to_string()]
        );
        assert!(from_toml.mcp_servers[0].enabled);
        assert_eq!(
            from_toml.mcp_servers[0].enabled_tools.as_deref(),
            Some(&["read_file".to_string(), "write_file".to_string()][..])
        );
        assert_eq!(from_toml.mcp_servers[1].id, "github");
        assert_eq!(from_toml.mcp_servers[1].name, "GitHub");
        assert_eq!(
            from_toml.mcp_servers[1].disabled_tools.as_deref(),
            Some(&["delete_repo".to_string()][..])
        );
        let github_env = from_toml.mcp_servers[1].env.as_ref().unwrap();
        assert_eq!(github_env.get("GITHUB_TOKEN").map(String::as_str), Some("ghp-test123"));

        // skills
        assert_eq!(from_toml.skills.len(), 2);
        assert_eq!(from_toml.skills[0].id, "pdf-tools");
        assert!(from_toml.skills[0].enabled);
        assert_eq!(from_toml.skills[1].id, "image-gen");
        assert!(!from_toml.skills[1].enabled);

        // agents
        assert_eq!(from_toml.agents.len(), 2);
        assert_eq!(from_toml.agents[0].id, "explorer");
        assert_eq!(from_toml.agents[0].name, "Explorer");
        assert_eq!(
            from_toml.agents[0].description.as_deref(),
            Some("Explores and answers questions about the codebase")
        );
        assert_eq!(from_toml.agents[0].kind, "internal");
        assert_eq!(from_toml.agents[0].command, "");
        assert!(from_toml.agents[0].args.is_empty());
        assert!(from_toml.agents[0].enabled);
        let bm = from_toml.agents[0].bound_model.as_ref().unwrap();
        assert_eq!(bm.provider_id, "deepseek");
        assert_eq!(bm.model_id, "deepseek-chat");
        assert_eq!(from_toml.agents[0].prompt.as_deref(), Some("You are a codebase explorer."));
        assert_eq!(
            from_toml.agents[0].allowed_tools.as_deref(),
            Some(&["read".to_string(), "grep".to_string(), "glob".to_string()][..])
        );
        assert_eq!(
            from_toml.agents[0].allowed_skills.as_deref(),
            Some(&["ast-grep".to_string()][..])
        );
        assert_eq!(
            from_toml.agents[0].allowed_mcp_servers.as_deref(),
            Some(&["filesystem".to_string()][..])
        );
        assert_eq!(from_toml.agents[1].id, "coder");
        assert_eq!(from_toml.agents[1].name, "Coder");
        assert_eq!(from_toml.agents[1].kind, "external");
        assert_eq!(from_toml.agents[1].command, "codex");
        assert_eq!(
            from_toml.agents[1].args,
            vec!["--model".to_string(), "gpt-5".to_string()]
        );
        assert!(from_toml.agents[1].bound_model.is_none());
        assert_eq!(from_toml.agents[1].quirks.as_deref(), Some("must-use-yolo-mode"));
        let coder_env = from_toml.agents[1].env.as_ref().unwrap();
        assert_eq!(coder_env.get("NODE_ENV").map(String::as_str), Some("production"));
        assert!(!from_toml.agents[1].enabled);

        // permissions
        let perms = from_toml.permissions.as_ref().unwrap();
        assert_eq!(perms.coarse_mode, "allow");
        let tp = perms.tool_permissions.as_ref().unwrap();
        assert_eq!(tp.default_mode, "ask");
        let overrides = tp.overrides.as_ref().unwrap();
        assert_eq!(overrides.get("bash").map(String::as_str), Some("allow"));
        assert_eq!(overrides.get("write").map(String::as_str), Some("deny"));
    }

    #[test]
    fn default_config_has_empty_sections() {
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(from_json.version, 1);
        assert!(from_json.providers.is_empty());
        assert!(from_json.mcp_servers.is_empty());
        assert!(from_json.skills.is_empty());
        assert!(from_json.agents.is_empty());
        assert!(from_json.fixed_agents.is_none());
        assert!(from_json.permissions.is_none());
        assert!(from_json.agent_loop.is_none());
    }

    #[test]
    fn agent_loop_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; agentLoop must not be stripped.
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: Some(super::AgentLoopConfig {
                max_steps: Some(400),
                child_max_steps: Some(20),
                explore_child_max_steps: Some(35),
                max_depth: Some(2),
                subagent_hitl: Some("inline_partial".into()),
                doom_loop_strategy: Some("pause_immediately".into()),
            }),
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        };

        // UI path: JSON (camelCase) → HipConfig → TomlHipConfig → TOML → back
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"agentLoop\""), "JSON must emit agentLoop: {json}");
        assert!(
            json.contains("\"doomLoopStrategy\""),
            "JSON must emit doomLoopStrategy: {json}"
        );
        assert!(json.contains("\"maxSteps\""), "JSON must emit maxSteps: {json}");
        assert!(json.contains("\"maxDepth\""), "JSON must emit maxDepth: {json}");
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("agent_loop") || toml_str.contains("[agent_loop]"),
            "TOML should use snake_case agent_loop: {toml_str}"
        );
        assert!(
            toml_str.contains("doom_loop_strategy") || toml_str.contains("pause_immediately"),
            "TOML should preserve doom_loop_strategy: {toml_str}"
        );
        assert!(
            toml_str.contains("max_steps") || toml_str.contains("400"),
            "TOML should preserve max_steps: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        let loop_cfg = back.agent_loop.as_ref().expect("agent_loop preserved");
        assert_eq!(loop_cfg.doom_loop_strategy.as_deref(), Some("pause_immediately"));
        assert_eq!(loop_cfg.max_steps, Some(400));
        assert_eq!(loop_cfg.child_max_steps, Some(20));
        assert_eq!(loop_cfg.explore_child_max_steps, Some(35));
        assert_eq!(loop_cfg.max_depth, Some(2));
        assert_eq!(loop_cfg.subagent_hitl.as_deref(), Some("inline_partial"));

        // Sidecar-written camelCase table alias
        let camel_toml = r#"
version = 1
[agentLoop]
maxSteps = 100
childMaxSteps = 15
exploreChildMaxSteps = 30
maxDepth = 4
doomLoopStrategy = "auto_continue"
"#;
        let from_camel: super::TomlHipConfig = toml::from_str(camel_toml).unwrap();
        let hip: super::HipConfig = from_camel.into();
        let camel_loop = hip.agent_loop.as_ref().expect("camel agentLoop");
        assert_eq!(camel_loop.doom_loop_strategy.as_deref(), Some("auto_continue"));
        assert_eq!(camel_loop.max_steps, Some(100));
        assert_eq!(camel_loop.child_max_steps, Some(15));
        assert_eq!(camel_loop.explore_child_max_steps, Some(30));
        assert_eq!(camel_loop.max_depth, Some(4));
    }

    #[test]
    fn terminal_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; terminal shell + colorTheme must not be stripped.
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: Some(super::hip_config::TerminalConfig {
                shell: Some("cmd".into()),
                color_theme: Some("dracula".into()),
            }),
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"terminal\""), "JSON must emit terminal: {json}");
        assert!(json.contains("\"shell\""), "JSON must emit shell: {json}");
        assert!(
            json.contains("\"colorTheme\""),
            "JSON must emit colorTheme: {json}"
        );
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("[terminal]") || toml_str.contains("terminal"),
            "TOML should contain terminal: {toml_str}"
        );
        assert!(
            toml_str.contains("shell") || toml_str.contains("cmd"),
            "TOML should preserve shell: {toml_str}"
        );
        assert!(
            toml_str.contains("color_theme") || toml_str.contains("dracula"),
            "TOML should emit color_theme: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        assert_eq!(
            back.terminal.as_ref().and_then(|t| t.shell.as_deref()),
            Some("cmd")
        );
        assert_eq!(
            back.terminal.as_ref().and_then(|t| t.color_theme.as_deref()),
            Some("dracula")
        );

        // Raw TOML snake_case fixture
        let snake = r#"
version = 1
[terminal]
shell = "zsh"
color_theme = "dracula"
"#;
        let snake_cfg: super::TomlHipConfig = toml::from_str(snake).unwrap();
        let snake_hip: super::HipConfig = snake_cfg.into();
        assert_eq!(
            snake_hip.terminal.as_ref().and_then(|t| t.shell.as_deref()),
            Some("zsh")
        );
        assert_eq!(
            snake_hip
                .terminal
                .as_ref()
                .and_then(|t| t.color_theme.as_deref()),
            Some("dracula")
        );

        // Raw TOML camelCase alias fixture
        let camel = r#"
version = 1
[terminal]
shell = "bash"
colorTheme = "one-dark"
"#;
        let camel_cfg: super::TomlHipConfig = toml::from_str(camel).unwrap();
        let camel_hip: super::HipConfig = camel_cfg.into();
        assert_eq!(
            camel_hip.terminal.as_ref().and_then(|t| t.shell.as_deref()),
            Some("bash")
        );
        assert_eq!(
            camel_hip
                .terminal
                .as_ref()
                .and_then(|t| t.color_theme.as_deref()),
            Some("one-dark")
        );
    }

    #[test]
    fn code_block_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; [code_block] must not be stripped.
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            code_block: Some(super::hip_config::CodeBlockConfig {
                color_theme: Some("dark".into()),
            }),
            knowledge: None,
            window: None,
            acp: None,
            plan: None,
            voice: None,
            proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"codeBlock\""), "JSON must emit codeBlock: {json}");
        assert!(json.contains("\"colorTheme\""), "JSON must emit colorTheme: {json}");
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("[code_block]") || toml_str.contains("code_block"),
            "TOML should contain code_block: {toml_str}"
        );
        assert!(
            toml_str.contains("color_theme") || toml_str.contains("dark"),
            "TOML should emit color_theme: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        assert_eq!(
            back.code_block.as_ref().and_then(|c| c.color_theme.as_deref()),
            Some("dark")
        );

        // Raw TOML snake_case fixture
        let snake = r#"
version = 1
[code_block]
color_theme = "light"
"#;
        let snake_cfg: super::TomlHipConfig = toml::from_str(snake).unwrap();
        let snake_hip: super::HipConfig = snake_cfg.into();
        assert_eq!(
            snake_hip.code_block.as_ref().and_then(|c| c.color_theme.as_deref()),
            Some("light")
        );

        // Raw TOML camelCase alias fixture
        let camel = r#"
version = 1
[codeBlock]
colorTheme = "follow"
"#;
        let camel_cfg: super::TomlHipConfig = toml::from_str(camel).unwrap();
        let camel_hip: super::HipConfig = camel_cfg.into();
        assert_eq!(
            camel_hip.code_block.as_ref().and_then(|c| c.color_theme.as_deref()),
            Some("follow")
        );
    }

    #[test]
    fn knowledge_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; [knowledge] must not be stripped.
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: Some(super::hip_config::KnowledgeConfig {
                doc_width: Some("wide".into()),
            }),
            window: None,
            acp: None,
            plan: None,
            voice: None,
            proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"knowledge\""), "JSON must emit knowledge: {json}");
        assert!(json.contains("\"docWidth\""), "JSON must emit docWidth: {json}");
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("[knowledge]") || toml_str.contains("knowledge"),
            "TOML should contain knowledge: {toml_str}"
        );
        assert!(
            toml_str.contains("doc_width") || toml_str.contains("wide"),
            "TOML should emit doc_width: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        assert_eq!(
            back.knowledge.as_ref().and_then(|k| k.doc_width.as_deref()),
            Some("wide")
        );

        // Raw TOML snake_case fixture
        let snake = r#"
version = 1
[knowledge]
doc_width = "full"
"#;
        let snake_cfg: super::TomlHipConfig = toml::from_str(snake).unwrap();
        let snake_hip: super::HipConfig = snake_cfg.into();
        assert_eq!(
            snake_hip.knowledge.as_ref().and_then(|k| k.doc_width.as_deref()),
            Some("full")
        );

        // Raw TOML camelCase alias fixture
        let camel = r#"
version = 1
[knowledge]
docWidth = "default"
"#;
        let camel_cfg: super::TomlHipConfig = toml::from_str(camel).unwrap();
        let camel_hip: super::HipConfig = camel_cfg.into();
        assert_eq!(
            camel_hip.knowledge.as_ref().and_then(|k| k.doc_width.as_deref()),
            Some("default")
        );
    }

    #[test]
    fn window_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; [window] must not be stripped.
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: Some(super::hip_config::WindowConfig {
                close_action: Some("hide".into()),
                tray_enabled: Some(true),
                tray_always_visible: None,
                close_prompt_seen: None,
                hide_hint_shown: None,
                launch_at_login: None,
                start_hidden_on_login: None,
                notify_on_agent_complete: None,
            }),
            acp: None,
            plan: None,
            voice: None,
        proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"window\""), "JSON must emit window: {json}");
        assert!(
            json.contains("\"closeAction\""),
            "JSON must emit closeAction: {json}"
        );
        assert!(
            json.contains("\"trayEnabled\""),
            "JSON must emit trayEnabled: {json}"
        );
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("[window]") || toml_str.contains("window"),
            "TOML should contain window: {toml_str}"
        );
        assert!(
            toml_str.contains("close_action") || toml_str.contains("hide"),
            "TOML should preserve close_action: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        assert_eq!(
            back.window.as_ref().and_then(|w| w.close_action.as_deref()),
            Some("hide")
        );
        assert_eq!(
            back.window.as_ref().and_then(|w| w.tray_enabled),
            Some(true)
        );

        let snake = r#"
version = 1
[window]
close_action = "quit"
tray_enabled = false
"#;
        let snake_cfg: super::TomlHipConfig = toml::from_str(snake).unwrap();
        let snake_hip: super::HipConfig = snake_cfg.into();
        assert_eq!(
            snake_hip
                .window
                .as_ref()
                .and_then(|w| w.close_action.as_deref()),
            Some("quit")
        );
        assert_eq!(
            snake_hip.window.as_ref().and_then(|w| w.tray_enabled),
            Some(false)
        );

        let camel = r#"
version = 1
[window]
closeAction = "hide"
trayEnabled = true
"#;
        let camel_cfg: super::TomlHipConfig = toml::from_str(camel).unwrap();
        let camel_hip: super::HipConfig = camel_cfg.into();
        assert_eq!(
            camel_hip
                .window
                .as_ref()
                .and_then(|w| w.close_action.as_deref()),
            Some("hide")
        );
        assert_eq!(
            camel_hip.window.as_ref().and_then(|w| w.tray_enabled),
            Some(true)
        );
    }

    #[test]
    fn acp_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; acp host policy must not be stripped.
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: Some(super::hip_config::AcpHostConfig {
                fs_bridge: Some(true),
                forward_mcp: Some(true),
                fs_read_max_bytes: Some(1_000_000),
            }),
            plan: None,
            voice: None,
        proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"acp\""), "JSON must emit acp: {json}");
        assert!(json.contains("\"forwardMcp\""), "JSON must emit forwardMcp: {json}");
        assert!(json.contains("\"fsBridge\""), "JSON must emit fsBridge: {json}");
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("[acp]") || toml_str.contains("acp"),
            "TOML should contain acp: {toml_str}"
        );
        assert!(
            toml_str.contains("forward_mcp") || toml_str.contains("true"),
            "TOML should preserve forward_mcp: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        let acp = back.acp.as_ref().expect("acp preserved");
        assert_eq!(acp.fs_bridge, Some(true));
        assert_eq!(acp.forward_mcp, Some(true));
        assert_eq!(acp.fs_read_max_bytes, Some(1_000_000));

        // snake_case + camelCase aliases
        let snake = r#"
version = 1
[acp]
fs_bridge = false
forward_mcp = true
fs_read_max_bytes = 500000
"#;
        let from_snake: super::TomlHipConfig = toml::from_str(snake).unwrap();
        let snake_acp = from_snake.acp.as_ref().expect("snake acp");
        assert_eq!(snake_acp.fs_bridge, Some(false));
        assert_eq!(snake_acp.forward_mcp, Some(true));
        assert_eq!(snake_acp.fs_read_max_bytes, Some(500_000));

        let camel = r#"
version = 1
[acp]
fsBridge = true
forwardMcp = false
fsReadMaxBytes = 2000000
"#;
        let from_camel: super::TomlHipConfig = toml::from_str(camel).unwrap();
        let camel_acp = from_camel.acp.as_ref().expect("camel acp");
        assert_eq!(camel_acp.fs_bridge, Some(true));
        assert_eq!(camel_acp.forward_mcp, Some(false));
        assert_eq!(camel_acp.fs_read_max_bytes, Some(2_000_000));
    }

    #[test]
    fn plan_survives_json_toml_roundtrip() {
        // set_hip_config rewrites hip.toml from typed HipConfig; [plan] must not be stripped (KD-8).
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            active_model: None,
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            fixed_agents: None,
            permissions: None,
            agent_loop: None,
            terminal: None,
            code_block: None,
            knowledge: None,
            window: None,
            acp: None,
            plan: Some(super::hip_config::PlanConfig {
                soft_approve_on_composer: Some(true),
            }),
            voice: None,
        proxy: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"plan\""), "JSON must emit plan: {json}");
        assert!(
            json.contains("\"softApproveOnComposer\""),
            "JSON must emit softApproveOnComposer: {json}"
        );
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        let toml_cfg: super::TomlHipConfig = from_json.into();
        let toml_str = toml::to_string_pretty(&toml_cfg).unwrap();
        assert!(
            toml_str.contains("[plan]") || toml_str.contains("plan"),
            "TOML should contain plan: {toml_str}"
        );
        assert!(
            toml_str.contains("soft_approve_on_composer") || toml_str.contains("true"),
            "TOML should preserve soft_approve_on_composer: {toml_str}"
        );
        let from_toml: super::TomlHipConfig = toml::from_str(&toml_str).unwrap();
        let back: super::HipConfig = from_toml.into();
        let plan = back.plan.as_ref().expect("plan preserved");
        assert_eq!(plan.soft_approve_on_composer, Some(true));

        // snake_case + camelCase aliases in hand-edited TOML
        let snake = r#"
version = 1
[plan]
soft_approve_on_composer = true
"#;
        let from_snake: super::TomlHipConfig = toml::from_str(snake).unwrap();
        assert_eq!(
            from_snake
                .plan
                .as_ref()
                .and_then(|p| p.soft_approve_on_composer),
            Some(true)
        );

        let camel = r#"
version = 1
[plan]
softApproveOnComposer = false
"#;
        let from_camel: super::TomlHipConfig = toml::from_str(camel).unwrap();
        assert_eq!(
            from_camel
                .plan
                .as_ref()
                .and_then(|p| p.soft_approve_on_composer),
            Some(false)
        );
    }


    #[test]
    fn invalid_toml_returns_error() {
        let result: Result<super::HipConfig, _> = toml::from_str("this is {{{ not toml");
        assert!(result.is_err());
    }

    #[test]
    fn mcp_server_entry_with_enabled_tools() {
        let json = r#"{"id":"srv-a","name":"Filtered","transport":"stdio","command":"npx","args":[],"enabledTools":["read_file","search"],"enabled":true}"#;
        let srv: super::McpServerEntry = serde_json::from_str(json).unwrap();
        assert_eq!(srv.id, "srv-a");
        let expected: Vec<String> = vec!["read_file".into(), "search".into()];
        assert_eq!(srv.enabled_tools.as_deref(), Some(expected.as_slice()));
        assert!(srv.disabled_tools.is_none());

        let toml_str = toml::to_string_pretty(&srv).unwrap();
        let from_toml: super::McpServerEntry = toml::from_str(&toml_str).unwrap();
        assert_eq!(from_toml.enabled_tools.as_deref(), Some(expected.as_slice()));
    }

    #[test]
    fn permission_entry_with_tool_overrides() {
        let mut overrides = std::collections::HashMap::new();
        overrides.insert("write_file".to_string(), "auto".to_string());
        overrides.insert("run_script".to_string(), "approve".to_string());

        let perm = super::PermissionEntry {
            coarse_mode: "full".into(),
            tool_permissions: Some(super::ToolPermissionConfig {
                default_mode: "prompt".into(),
                overrides: Some(overrides),
            }),
        };

        let json = serde_json::to_string(&perm).unwrap();
        let from_json: super::PermissionEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(from_json.coarse_mode, "full");
        let tp = from_json.tool_permissions.as_ref().unwrap();
        assert_eq!(tp.default_mode, "prompt");
        assert_eq!(tp.overrides.as_ref().unwrap().get("write_file"), Some(&"auto".to_string()));

        let toml_str = toml::to_string_pretty(&perm).unwrap();
        let from_toml: super::PermissionEntry = toml::from_str(&toml_str).unwrap();
        assert_eq!(from_toml.coarse_mode, "full");
    }

    #[test]
    fn hip_config_sections_optional_in_toml() {
        let minimal = "version = 1\n";
        let cfg: super::HipConfig = toml::from_str(minimal).unwrap();
        assert_eq!(cfg.version, 1);
        assert!(cfg.providers.is_empty());
        assert!(cfg.mcp_servers.is_empty());
        assert!(cfg.skills.is_empty());
        assert!(cfg.agents.is_empty());
        assert!(cfg.fixed_agents.is_none());
        assert!(cfg.permissions.is_none());
        assert!(cfg.agent_loop.is_none());
    }

    #[test]
    fn toml_mirror_accepts_camelcase_keys() {
        // Simulate a TOML file written with camelCase keys (e.g. by older Rust
        // structs that used `#[serde(rename_all = "camelCase")]`). The
        // TomlHipConfig mirror struct should accept these via serde aliases and
        // re-serialize them as snake_case.
        let camel_toml = r#"
version = 1

[[providers]]
id = "openai"
name = "OpenAI"
baseUrl = "https://api.openai.com/v1"
apiKey = "sk-abc"
enabled = true

[[mcpServers]]
id = "srv-1"
name = "Local"
transport = "stdio"
command = "npx"
enabledTools = ["read_file", "search"]
enabled = true

[[agents]]
id = "helper"
name = "Helper"
kind = "internal"
command = ""
allowedTools = ["read"]
allowedSkills = ["pdf-tools"]
allowedMcpServers = ["srv-1"]
prompt = "You help."
enabled = true

[[agents]]
id = "coder"
name = "Coder"
kind = "external"
command = "codex"
args = ["--model", "gpt-5"]
enabled = true

[agents.boundModel]
providerId = "openai"
modelId = "gpt-4o"

[permissions]
coarseMode = "edit"

[permissions.toolPermissions]
defaultMode = "prompt"
"#;

        let cfg: super::TomlHipConfig =
            toml::from_str(camel_toml).expect("should parse camelCase TOML");

        // Verify data was populated correctly
        assert_eq!(cfg.version, 1);
        assert_eq!(cfg.providers.len(), 1);
        assert_eq!(cfg.providers[0].id, "openai");
        assert_eq!(cfg.providers[0].name, "OpenAI");
        assert_eq!(cfg.providers[0].base_url, "https://api.openai.com/v1");
        assert_eq!(cfg.providers[0].api_key.as_deref(), Some("sk-abc"));

        assert_eq!(cfg.mcp_servers.len(), 1);
        assert_eq!(cfg.mcp_servers[0].id, "srv-1");
        let expected_tools: Vec<String> = vec!["read_file".into(), "search".into()];
        assert_eq!(cfg.mcp_servers[0].enabled_tools.as_deref(), Some(expected_tools.as_slice()));
        assert!(cfg.mcp_servers[0].enabled);

        assert_eq!(cfg.agents.len(), 2);
        assert_eq!(cfg.agents[0].id, "helper");
        assert_eq!(cfg.agents[0].allowed_tools.as_deref(), Some(&["read".into()][..]));
        assert_eq!(cfg.agents[0].allowed_skills.as_deref(), Some(&["pdf-tools".into()][..]));
        assert_eq!(cfg.agents[0].allowed_mcp_servers.as_deref(), Some(&["srv-1".into()][..]));
        assert!(cfg.agents[0].enabled);

        assert_eq!(cfg.agents[1].id, "coder");
        let bm = cfg.agents[1].bound_model.as_ref().expect("coder should have boundModel");
        assert_eq!(bm.provider_id, "openai");
        assert_eq!(bm.model_id, "gpt-4o");

        let perm = cfg.permissions.as_ref().expect("should have permissions");
        assert_eq!(perm.coarse_mode, "edit");
        let tp = perm.tool_permissions.as_ref().expect("should have toolPermissions");
        assert_eq!(tp.default_mode, "prompt");

        // Re-serialize and assert output uses snake_case keys only
        let out = toml::to_string_pretty(&cfg).expect("should re-serialize");
        assert!(out.contains("mcp_servers"), "re-serialized TOML must use snake_case: mcp_servers");
        assert!(!out.contains("mcpServers"), "re-serialized TOML must NOT contain camelCase: mcpServers");
        assert!(out.contains("enabled_tools"), "re-serialized TOML must use snake_case: enabled_tools");
        assert!(!out.contains("enabledTools"), "re-serialized TOML must NOT contain camelCase: enabledTools");
        assert!(out.contains("allowed_tools"), "re-serialized TOML must use snake_case: allowed_tools");
        assert!(!out.contains("allowedTools"), "re-serialized TOML must NOT contain camelCase: allowedTools");
        assert!(out.contains("allowed_skills"), "re-serialized TOML must use snake_case: allowed_skills");
        assert!(!out.contains("allowedSkills"), "re-serialized TOML must NOT contain camelCase: allowedSkills");
        assert!(out.contains("allowed_mcp_servers"), "re-serialized TOML must use snake_case: allowed_mcp_servers");
        assert!(!out.contains("allowedMcpServers"), "re-serialized TOML must NOT contain camelCase: allowedMcpServers");
        assert!(out.contains("base_url"), "re-serialized TOML must use snake_case: base_url");
        assert!(!out.contains("baseUrl"), "re-serialized TOML must NOT contain camelCase: baseUrl");
        assert!(out.contains("api_key"), "re-serialized TOML must use snake_case: api_key");
        assert!(!out.contains("apiKey"), "re-serialized TOML must NOT contain camelCase: apiKey");
        assert!(out.contains("provider_id"), "re-serialized TOML must use snake_case: provider_id");
        assert!(!out.contains("providerId"), "re-serialized TOML must NOT contain camelCase: providerId");
        assert!(out.contains("model_id"), "re-serialized TOML must use snake_case: model_id");
        assert!(!out.contains("modelId"), "re-serialized TOML must NOT contain camelCase: modelId");
        assert!(out.contains("coarse_mode"), "re-serialized TOML must use snake_case: coarse_mode");
        assert!(!out.contains("coarseMode"), "re-serialized TOML must NOT contain camelCase: coarseMode");
        assert!(out.contains("tool_permissions"), "re-serialized TOML must use snake_case: tool_permissions");
        assert!(!out.contains("toolPermissions"), "re-serialized TOML must NOT contain camelCase: toolPermissions");
        assert!(out.contains("default_mode"), "re-serialized TOML must use snake_case: default_mode");
        assert!(!out.contains("defaultMode"), "re-serialized TOML must NOT contain camelCase: defaultMode");

        // Also verify that a mixed TOML (some camelCase, some snake_case) can deserialize
        let mixed_toml = r#"
version = 1

[[providers]]
id = "openai"
name = "OpenAI"
base_url = "https://api.openai.com/v1"
enabled = true

[[mcpServers]]
id = "srv-2"
name = "Remote"
transport = "sse"
url = "https://example.com/mcp"
enabled = false
"#;
        let cfg2: super::TomlHipConfig =
            toml::from_str(mixed_toml).expect("should parse mixed-case TOML");
        assert_eq!(cfg2.providers[0].base_url, "https://api.openai.com/v1");
        assert_eq!(cfg2.mcp_servers[0].id, "srv-2");
        assert_eq!(cfg2.mcp_servers[0].url.as_deref(), Some("https://example.com/mcp"));
    }

    #[test]
    fn read_network_policy_returns_default_when_missing() {
        let dir = std::env::temp_dir().join(format!("hip-netpol-missing-{}", std::process::id()));
        let path = dir.join("network.json");
        let result = super::read_network_policy(&path);
        assert_eq!(result.unwrap(), "{}");
    }

    #[test]
    fn write_network_policy_rejects_invalid_json() {
        let dir = std::env::temp_dir().join(format!("hip-netpol-invalid-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("network.json");
        let result = super::write_network_policy(&path, "not json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("JSON parse error"));
    }

    #[test]
    fn network_policy_roundtrip_pretty_json() {
        let dir = std::env::temp_dir().join(format!("hip-netpol-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("network.json");

        let input = r#"{"allowlist":["https://example.com"],"maxRequestsPerMinute":100}"#;
        super::write_network_policy(&path, input).unwrap();

        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains("allowlist"));
        assert!(contents.contains("https://example.com"));
        assert!(contents.contains("maxRequestsPerMinute"));

        let read_back = super::read_network_policy(&path).unwrap();
        let cfg: super::NetworkPolicyConfig = serde_json::from_str(&read_back).unwrap();
        assert_eq!(cfg.allowlist.as_deref(), Some(&["https://example.com".to_string()][..]));
        assert_eq!(cfg.max_requests_per_minute, Some(100));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn network_policy_write_creates_parent_dirs() {
        let dir = std::env::temp_dir().join(format!("hip-netpol-nested-{}", std::process::id()));
        let nested = dir.join("a").join("b");
        let path = nested.join("network.json");

        let input = r#"{"denylist":["https://evil.com"]}"#;
        let result = super::write_network_policy(&path, input);
        assert!(result.is_err());
    }
}
