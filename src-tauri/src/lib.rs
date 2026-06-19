mod sidecar;
mod paths;
mod auth;
mod skills;
mod plugins;
mod path_env;

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
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

// ── Unified TOML config types (wave 1) ──

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct BoundModel {
    provider_id: String,
    model_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ProviderEntry {
    id: String,
    name: String,
    base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct McpServerEntry {
    id: String,
    name: String,
    transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    headers: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    enabled_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    disabled_tools: Option<Vec<String>>,
    enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AgentEntry {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    kind: String,
    command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    args: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bound_model: Option<BoundModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quirks: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    allowed_tools: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    allowed_skills: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    allowed_mcp_servers: Option<Vec<String>>,
    enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SkillEntry {
    id: String,
    enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ToolPermissionConfig {
    default_mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    overrides: Option<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PermissionEntry {
    coarse_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_permissions: Option<ToolPermissionConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct HipConfig {
    version: u32,
    #[serde(default)]
    providers: Vec<ProviderEntry>,
    #[serde(default)]
    mcp_servers: Vec<McpServerEntry>,
    #[serde(default)]
    skills: Vec<SkillEntry>,
    #[serde(default)]
    agents: Vec<AgentEntry>,
    #[serde(default)]
    permissions: Option<PermissionEntry>,
}

// ── Legacy JSON deserialization helpers (read-only migration) ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LegacyProviderEntry {
    enabled: bool,
    #[serde(default, alias = "baseURL")]
    base_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LegacyProvidersConfig {
    providers: HashMap<String, LegacyProviderEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LegacyAgentsConfig {
    agents: Vec<AgentEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LegacyMcpServersConfig {
    servers: Vec<McpServerEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LegacySkillsConfig {
    enabled: HashMap<String, bool>,
}

#[tauri::command]
fn get_sidecar_info(state: tauri::State<SidecarState>) -> Option<sidecar::SidecarInfo> {
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

/// Read a single merged HipConfig from the legacy JSON files (read-only, never deletes).
#[allow(dead_code)]
fn from_legacy_json(app: &tauri::AppHandle) -> HipConfig {
    let mut cfg = HipConfig {
        version: 1,
        providers: vec![],
        mcp_servers: vec![],
        skills: vec![],
        agents: vec![],
        permissions: None,
    };

    if let Some(p) = paths::providers_config_path(app) {
        if let Ok(body) = std::fs::read_to_string(&p) {
            if let Ok(legacy) = serde_json::from_str::<LegacyProvidersConfig>(&body) {
                cfg.providers = legacy
                    .providers
                    .into_iter()
                    .filter(|(_, v)| v.enabled)
                    .map(|(id, v)| ProviderEntry {
                        id: id.clone(),
                        name: id,
                        base_url: v.base_url.unwrap_or_default(),
                        api_key: None,
                    })
                    .collect();
            }
        }
    }

    if let Some(p) = paths::agents_config_path(app) {
        if let Ok(body) = std::fs::read_to_string(&p) {
            if let Ok(legacy) = serde_json::from_str::<LegacyAgentsConfig>(&body) {
                cfg.agents = legacy.agents;
            }
        }
    }

    if let Some(p) = paths::mcp_servers_config_path(app) {
        if let Ok(body) = std::fs::read_to_string(&p) {
            if let Ok(legacy) = serde_json::from_str::<LegacyMcpServersConfig>(&body) {
                cfg.mcp_servers = legacy.servers;
            }
        }
    }

    if let Some(p) = paths::skills_config_path(app) {
        if let Ok(body) = std::fs::read_to_string(&p) {
            if let Ok(legacy) = serde_json::from_str::<LegacySkillsConfig>(&body) {
                cfg.skills = legacy
                    .enabled
                    .into_iter()
                    .map(|(id, enabled)| SkillEntry { id, enabled })
                    .collect();
            }
        }
    }

    cfg
}

#[tauri::command]
fn get_hip_config(app: tauri::AppHandle) -> Result<String, String> {
    let path = paths::hip_config_path(&app).ok_or("no config dir")?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => {
            let cfg: HipConfig =
                toml::from_str(&raw).map_err(|e| format!("TOML parse error: {e}"))?;
            serde_json::to_string(&cfg).map_err(|e| e.to_string())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let cfg = HipConfig {
                version: 1,
                providers: vec![],
                mcp_servers: vec![],
                skills: vec![],
                agents: vec![],
                permissions: None,
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
    let toml_str =
        toml::to_string_pretty(&cfg).map_err(|e| format!("TOML serialize error: {e}"))?;
    let path = paths::hip_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&path, toml_str).map_err(|e| e.to_string())
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
    Ok(auth::auth_get(&auth_path(&app)?, &key))
}

#[tauri::command]
fn has_secret(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    Ok(get_secret(app, key)?.is_some())
}

#[tauri::command]
fn delete_secret(app: tauri::AppHandle, key: String) -> Result<(), String> {
    auth::auth_delete(&auth_path(&app)?, &key).map_err(|e| e.to_string())
}

const MODELS_URL: &str = "https://models.dev/api.json";
const CATALOG_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const SNAPSHOT: &str = include_str!("../resources/models-snapshot.json");

#[tauri::command]
fn get_providers_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::providers_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_providers_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::providers_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_agents_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::agents_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_agents_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::agents_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

/// True if `p` is a file and (on unix) has any execute bit set.
fn is_executable(p: &std::path::Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(p) {
            Ok(m) => m.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// For each name, true iff an executable of that name exists in any of `dirs`.
/// `names` are expected to be bare binary names (from the app's ACP preset list),
/// not paths — they are joined onto each PATH dir as-is.
fn find_on_path(
    names: &[String],
    dirs: &[std::path::PathBuf],
) -> std::collections::HashMap<String, bool> {
    names
        .iter()
        .map(|n| (n.clone(), dirs.iter().any(|d| is_executable(&d.join(n)))))
        .collect()
}

/// Probe PATH for each requested executable. Uses this process's inherited PATH —
/// the SAME env the sidecar (and thus spawned ACP agents) inherits — so a `true`
/// here honestly predicts the agent will be spawnable.
#[tauri::command]
fn which_binaries(names: Vec<String>) -> Result<std::collections::HashMap<String, bool>, String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path)
        .filter(|d| !d.as_os_str().is_empty())
        .collect();
    Ok(find_on_path(&names, &dirs))
}

#[tauri::command]
fn get_mcp_servers_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::mcp_servers_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_mcp_servers_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::mcp_servers_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_plugins_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::plugins_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_plugins_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::plugins_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_worktrees(app: tauri::AppHandle) -> Result<String, String> {
    let dir = paths::worktrees_dir(&app).ok_or("no worktrees dir")?;
    let mut entries: Vec<String> = Vec::new();
    if let Ok(read) = std::fs::read_dir(&dir) {
        for entry in read.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(name) = entry.file_name().to_str() {
                    entries.push(name.to_string());
                }
            }
        }
    }
    serde_json::to_string(&entries).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_plugins(app: tauri::AppHandle) -> Result<String, String> {
    let dir = paths::plugins_dir(&app).ok_or("no plugins dir")?;
    let metas = plugins::scan_plugins(&dir);
    serde_json::to_string(&metas).map_err(|e| e.to_string())
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
        plugins::register_plugin(&config_path, manifest)?;
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
    let skill_dir = paths::skills_dir(&app).ok_or("no skills dir")?.join(&id);
    let target = skills::safe_join(&skill_dir, &rel).ok_or("非法文件路径")?;
    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_skills_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::skills_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_skills_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::skills_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn models_catalog(app: tauri::AppHandle) -> Result<String, String> {
    let cache = paths::cache_dir(&app).map(|d| d.join("models.json"));
    if let Some(ref c) = cache {
        if let Ok(meta) = std::fs::metadata(c) {
            if let Ok(modified) = meta.modified() {
                if SystemTime::now().duration_since(modified).unwrap_or(CATALOG_TTL) < CATALOG_TTL {
                    if let Ok(body) = std::fs::read_to_string(c) {
                        return Ok(body);
                    }
                }
            }
        }
    }
    let url = std::env::var("HIP_MODELS_URL").unwrap_or_else(|_| MODELS_URL.to_string());
    match reqwest::get(&url).await.and_then(|r| r.error_for_status()) {
        Ok(resp) => match resp.text().await {
            Ok(body) => {
                if let Some(ref c) = cache {
                    let _ = std::fs::write(c, &body);
                }
                Ok(body)
            }
            Err(_) => fallback_catalog(cache.as_deref()),
        },
        Err(_) => fallback_catalog(cache.as_deref()),
    }
}

fn fallback_catalog(cache: Option<&std::path::Path>) -> Result<String, String> {
    if let Some(c) = cache {
        if let Ok(body) = std::fs::read_to_string(c) {
            return Ok(body);
        }
    }
    Ok(SNAPSHOT.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A GUI/IDE-launched macOS app inherits a stripped PATH; resolve the user's real
    // global PATH first so detection (which_binaries), the sidecar, and every spawned
    // ACP/CLI agent can find globally-installed tools.
    path_env::ensure_user_path();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_wdio_webdriver::init())
        .manage(SidecarState::new())
        .setup(|app| {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_info,
            restart_sidecar,
            set_secret,
            get_secret,
            has_secret,
            delete_secret,
            models_catalog,
            get_providers_config,
            set_providers_config,
            get_agents_config,
            set_agents_config,
            get_mcp_servers_config,
            set_mcp_servers_config,
            get_hip_config,
            set_hip_config,
            list_skills,
            install_skill_zip,
            delete_skill,
            read_skill_file,
            get_skills_config,
            set_skills_config,
            get_plugins_config,
            set_plugins_config,
            list_plugins,
            install_plugin,
            delete_plugin,
            list_worktrees,
            which_binaries
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| match event {
        // Graceful quit (Cmd+Q / AppHandle::exit): kill the managed sidecar.
        // NOTE: this fires ONLY for GUI/programmatic exits — a SIGTERM/SIGKILL to
        // this process (e.g. E2E teardown) runs no handler, so the sidecar also
        // self-terminates when our stdin pipe closes (HIP_PARENT_WATCH; sidecar.rs).
        tauri::RunEvent::ExitRequested { .. } => {
            if let Some(child) = app_handle.state::<SidecarState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
        // On macOS, closing the (single) window does not quit the app by default,
        // which would leave the sidecar running. For this single-window app, treat
        // window close as quit: exit() routes through ExitRequested above.
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { .. },
            ..
        } => {
            app_handle.exit(0);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

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
        let got = super::find_on_path(&names, &[PathBuf::from(&dir)]);
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
        let got = super::find_on_path(&["opencode".to_string()], &[std::path::PathBuf::from(&dir)]);
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
            }],
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
            permissions: Some(super::PermissionEntry {
                coarse_mode: "edit".into(),
                tool_permissions: None,
            }),
        }
    }

    #[test]
    fn toml_roundtrip_preserves_all_sections() {
        let cfg = sample_config();

        let toml_str = toml::to_string_pretty(&cfg).unwrap();
        let from_toml: super::HipConfig = toml::from_str(&toml_str).unwrap();

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

        let toml_str = toml::to_string_pretty(&from_json).unwrap();
        let from_toml: super::HipConfig = toml::from_str(&toml_str).unwrap();

        let json2 = serde_json::to_string(&from_toml).unwrap();
        let from_json2: super::HipConfig = serde_json::from_str(&json2).unwrap();
        assert_eq!(from_json2.version, 1);
        assert_eq!(from_json2.mcp_servers[0].id, "srv-1");
    }

    #[test]
    fn default_config_has_empty_sections() {
        let cfg = super::HipConfig {
            version: 1,
            providers: vec![],
            mcp_servers: vec![],
            skills: vec![],
            agents: vec![],
            permissions: None,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        let from_json: super::HipConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(from_json.version, 1);
        assert!(from_json.providers.is_empty());
        assert!(from_json.mcp_servers.is_empty());
        assert!(from_json.skills.is_empty());
        assert!(from_json.agents.is_empty());
        assert!(from_json.permissions.is_none());
    }

    #[test]
    fn invalid_toml_returns_error() {
        let result: Result<super::HipConfig, _> = toml::from_str("this is {{{ not toml");
        assert!(result.is_err());
    }

    #[test]
    fn legacy_providers_migration_parses_enabled_only() {
        let json = r#"{"providers":{"openai":{"enabled":true,"baseURL":"https://api.openai.com/v1"},"off":{"enabled":false,"baseURL":"https://x.com"}}}"#;
        let legacy: super::LegacyProvidersConfig = serde_json::from_str(json).unwrap();
        assert_eq!(legacy.providers.len(), 2);

        let providers: Vec<super::ProviderEntry> = legacy
            .providers
            .into_iter()
            .filter(|(_, v)| v.enabled)
            .map(|(id, v)| super::ProviderEntry {
                id: id.clone(),
                name: id,
                base_url: v.base_url.unwrap_or_default(),
                api_key: None,
            })
            .collect();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "openai");
        assert_eq!(providers[0].base_url, "https://api.openai.com/v1");
    }

    #[test]
    fn legacy_skills_migration_converts_to_entries() {
        let json = r#"{"enabled":{"pdf-tools":true,"git-tools":false}}"#;
        let legacy: super::LegacySkillsConfig = serde_json::from_str(json).unwrap();
        let skills: Vec<super::SkillEntry> = legacy
            .enabled
            .into_iter()
            .map(|(id, enabled)| super::SkillEntry { id, enabled })
            .collect();
        assert_eq!(skills.len(), 2);
        let pdf = skills.iter().find(|s| s.id == "pdf-tools").unwrap();
        assert!(pdf.enabled);
        let git = skills.iter().find(|s| s.id == "git-tools").unwrap();
        assert!(!git.enabled);
    }

    #[test]
    fn legacy_agents_migration_parses_directly() {
        let json = r#"{"agents":[{"id":"helper","name":"Helper","kind":"internal","command":"","args":[],"enabled":true,"prompt":"You help."}]}"#;
        let legacy: super::LegacyAgentsConfig = serde_json::from_str(json).unwrap();
        assert_eq!(legacy.agents.len(), 1);
        assert_eq!(legacy.agents[0].id, "helper");
        assert_eq!(legacy.agents[0].enabled, true);
    }

    #[test]
    fn legacy_mcp_servers_migration_parses_directly() {
        let json = r#"{"servers":[{"id":"srv-1","name":"Local","transport":"stdio","command":"npx","args":[],"enabled":true}]}"#;
        let legacy: super::LegacyMcpServersConfig = serde_json::from_str(json).unwrap();
        assert_eq!(legacy.servers.len(), 1);
        assert_eq!(legacy.servers[0].id, "srv-1");
        assert_eq!(legacy.servers[0].transport, "stdio");
    }

    #[test]
    fn from_legacy_json_integration() {
        let dir =
            std::env::temp_dir().join(format!("hip-legacy-test-{}", std::process::id()));
        let config_dir = dir.join("config");
        std::fs::create_dir_all(&config_dir).unwrap();

        std::fs::write(
            config_dir.join("hip-providers.json"),
            r#"{"providers":{"openai":{"enabled":true,"baseURL":"https://api.openai.com/v1"}}}"#,
        )
        .unwrap();
        std::fs::write(
            config_dir.join("hip-skills.json"),
            r#"{"enabled":{"pdf-tools":true}}"#,
        )
        .unwrap();
        std::fs::write(
            config_dir.join("hip-agents.json"),
            r#"{"agents":[{"id":"helper","name":"Helper","kind":"internal","command":"","args":[],"enabled":true,"prompt":"You help."}]}"#,
        )
        .unwrap();
        std::fs::write(
            config_dir.join("hip-mcp-servers.json"),
            r#"{"servers":[{"id":"srv-1","name":"Local","transport":"stdio","command":"npx","args":[],"enabled":true}]}"#,
        )
        .unwrap();

        // Simulate what from_legacy_json does (cannot call it without AppHandle)
        let providers_body =
            std::fs::read_to_string(config_dir.join("hip-providers.json")).unwrap();
        let legacy_p: super::LegacyProvidersConfig =
            serde_json::from_str(&providers_body).unwrap();
        let providers: Vec<super::ProviderEntry> = legacy_p
            .providers
            .into_iter()
            .filter(|(_, v)| v.enabled)
            .map(|(id, v)| super::ProviderEntry {
                id: id.clone(),
                name: id,
                base_url: v.base_url.unwrap_or_default(),
                api_key: None,
            })
            .collect();
        assert_eq!(providers.len(), 1);

        let skills_body =
            std::fs::read_to_string(config_dir.join("hip-skills.json")).unwrap();
        let legacy_s: super::LegacySkillsConfig =
            serde_json::from_str(&skills_body).unwrap();
        assert_eq!(legacy_s.enabled.get("pdf-tools"), Some(&true));

        let _ = std::fs::remove_dir_all(&dir);
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
        assert!(cfg.permissions.is_none());
    }
}
