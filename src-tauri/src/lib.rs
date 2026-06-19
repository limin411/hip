mod sidecar;
mod paths;
mod auth;
mod skills;
mod path_env;

use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
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
fn list_skills(app: tauri::AppHandle) -> Result<String, String> {
    let dir = paths::skills_dir(&app).ok_or("no skills dir")?;
    let metas = skills::scan_skills(&dir);
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
            list_skills,
            install_skill_zip,
            delete_skill,
            read_skill_file,
            get_skills_config,
            set_skills_config,
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
}
