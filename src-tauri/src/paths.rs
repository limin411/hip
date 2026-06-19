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
pub fn hip_base_dir(app: &AppHandle) -> Option<PathBuf> {
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

/// Canonical path of the non-secret provider config inside `config/`.
/// Single source of truth so the renderer-writer and the sidecar-reader can't drift.
pub fn providers_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-providers.json"))
}

/// Canonical path of the external-agent registry inside `config/`.
pub fn agents_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-agents.json"))
}

/// Canonical path of the MCP-servers registry inside `config/`.
pub fn mcp_servers_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-mcp-servers.json"))
}

/// Canonical path of the file-backed secret store inside `config/`.
pub fn auth_json_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("auth.json"))
}

/// Directory holding installed Claude-format skills (`<dir>/<skill-id>/SKILL.md`).
pub fn skills_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "skills")
}

/// Canonical path of the skill enable/disable table inside `config/`.
pub fn skills_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-skills.json"))
}

/// Canonical path of the plugin registry inside `config/`.
pub fn plugins_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-plugins.json"))
}

/// Directory holding installed plugins (`<dir>/<plugin-id>/.plugin/plugin.json`).
pub fn plugins_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "plugins")
}

/// Directory holding git worktrees for agent workspace isolation.
pub fn worktrees_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "worktrees")
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

    // The skill layout: `skills_dir` resolves to `<base>/skills` (via `hip_subdir`)
    // and `skills_config_path` to `<base>/config/hip-skills.json` (via `config_dir`).
    // Both wrap `hip_base_dir` = `hip_base_from(HOME, app_data)`, so composing the
    // real pure core with the exact subpaths the wrappers append pins the actual
    // on-disk layout these two functions produce.
    #[test]
    #[cfg(not(windows))]
    fn skills_layout_lives_under_base() {
        let base = hip_base_from(Some(PathBuf::from("/Users/x")), None).unwrap();
        // `skills_dir(app)` → `hip_subdir(app, "skills")` → `<base>/skills`.
        assert_eq!(base.join("skills"), PathBuf::from("/Users/x/.hip/skills"));
        // `skills_config_path(app)` → `config_dir(app)?.join("hip-skills.json")`
        // → `<base>/config/hip-skills.json`.
        assert_eq!(
            base.join("config").join("hip-skills.json"),
            PathBuf::from("/Users/x/.hip/config/hip-skills.json"),
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_uses_app_data() {
        let base = hip_base_from(
            Some(PathBuf::from(r"C:\Users\x")),
            Some(PathBuf::from(r"C:\AppData\com.ljm.app")),
        );
        assert_eq!(base, Some(PathBuf::from(r"C:\AppData\com.ljm.app")));
    }
}
