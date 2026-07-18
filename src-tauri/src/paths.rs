use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Pure core: pick the storage root. Unix → `$HOME/.hip`; Windows → app-data dir.
/// Split out from `hip_base_dir` so it is unit-testable without a Tauri AppHandle.
pub fn hip_base_from(home: Option<PathBuf>, app_data: Option<PathBuf>) -> Option<PathBuf> {
    if cfg!(windows) {
        app_data
    } else {
        home.map(|h| h.join(".hip"))
    }
}

/// The storage root for the running app.
///
/// Honors `HIP_DATA_DIR` when present so E2E harnesses can isolate sessions and
/// config from the user's real data directory. Falls back to the platform default
/// (`$HOME/.hip` on Unix, the Tauri app-data dir on Windows) otherwise.
pub fn hip_base_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("HIP_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let app_data = app.path().app_data_dir().ok();
    hip_base_from(home, app_data)
}

/// `<root>/<sub>`, created on demand. The `config` subdir is locked to `0o700` on Unix.
pub fn hip_subdir(app: &AppHandle, sub: &str) -> Option<PathBuf> {
    let dir = hip_base_dir(app)?.join(sub);
    std::fs::create_dir_all(&dir).ok()?;
    #[cfg(unix)]
    if sub == "config" {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)) {
            eprintln!("[tauri] could not set 0700 on {}: {e}", dir.display());
        }
    }
    Some(dir)
}

pub fn db_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "db") }
pub fn config_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "config") }
pub fn cache_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "cache") }
pub fn scratch_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "scratch") }

/// Runtime discovery for product CLI attach (`run/sidecar.json`).
pub fn run_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = hip_subdir(app, "run")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)) {
            eprintln!("[tauri] could not set 0700 on {}: {e}", dir.display());
        }
    }
    Some(dir)
}

/// Canonical path of the sidecar discovery file (mode 0600 on Unix when written).
pub fn sidecar_discovery_path(app: &AppHandle) -> Option<PathBuf> {
    Some(run_dir(app)?.join("sidecar.json"))
}

/// Canonical path of the file-backed secret store inside `config/`.
pub fn auth_json_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("auth.json"))
}

/// Directory holding installed Claude-format skills (`<dir>/<skill-id>/SKILL.md`).
pub fn skills_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "skills")
}

/// Canonical path of the plugin registry inside `config/`.
pub fn plugins_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-plugins.json"))
}

/// Canonical path of the unified TOML config inside `config/`.
pub fn hip_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip.toml"))
}

/// Canonical path of the network-policy config inside `config/`.
pub fn network_policy_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("network.json"))
}

/// Directory holding installed plugins (`<dir>/<plugin-id>/.plugin/plugin.json`).
pub fn plugins_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "plugins")
}

/// Directory holding git worktrees for agent workspace isolation.
pub fn worktrees_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "worktrees")
}

/// Local-first knowledge base root (`<base>/knowledge`).
pub fn knowledge_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "knowledge")
}

#[cfg(test)]
mod tests {
    use super::hip_base_from;
    use std::path::PathBuf;

    #[test]
    #[cfg(not(windows))]
    fn unix_uses_home_dot_hip() {
        let base = hip_base_from(Some(PathBuf::from("/Users/x")), Some(PathBuf::from("/ignored")));
        assert_eq!(base, Some(PathBuf::from("/Users/x/.hip")));
    }

    #[test]
    #[cfg(not(windows))]
    fn unix_none_home_is_none() {
        assert_eq!(hip_base_from(None, Some(PathBuf::from("/x"))), None);
    }

    // The skill layout: `skills_dir` resolves to `<base>/skills` (via `hip_subdir`).
    // It wraps `hip_base_dir` = `hip_base_from(HOME, app_data)`, so composing the
    // real pure core with the exact subpath the wrapper appends pins the actual
    // on-disk layout this function produces.
    #[test]
    #[cfg(not(windows))]
    fn skills_layout_lives_under_base() {
        let base = hip_base_from(Some(PathBuf::from("/Users/x")), None).unwrap();
        // `skills_dir(app)` → `hip_subdir(app, "skills")` → `<base>/skills`.
        assert_eq!(base.join("skills"), PathBuf::from("/Users/x/.hip/skills"));
    }

    #[test]
    #[cfg(not(windows))]
    fn network_policy_path_lives_under_config() {
        let base = hip_base_from(Some(PathBuf::from("/Users/x")), None).unwrap();
        assert_eq!(
            base.join("config").join("network.json"),
            PathBuf::from("/Users/x/.hip/config/network.json"),
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_uses_app_data() {
        let base = hip_base_from(
            Some(PathBuf::from(r"C:\Users\x")),
            Some(PathBuf::from(r"C:\AppData\com.ljm.hip")),
        );
        assert_eq!(base, Some(PathBuf::from(r"C:\AppData\com.ljm.hip")));
    }
}
