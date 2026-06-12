mod sidecar;
mod paths;
mod auth;

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
    Ok(paths::config_dir(app).ok_or("no config dir")?.join("auth.json"))
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

fn providers_config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("hip-providers.json"))
}

#[tauri::command]
fn get_providers_config(app: tauri::AppHandle) -> Result<String, String> {
    match providers_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_providers_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = providers_config_path(&app).ok_or("no app data dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn models_catalog(app: tauri::AppHandle) -> Result<String, String> {
    let cache = app.path().app_data_dir().ok().map(|d| d.join("models.json"));
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
            set_providers_config
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
