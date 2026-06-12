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
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Some(dir)
}

pub fn db_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "db") }
pub fn config_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "config") }
pub fn cache_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "cache") }
pub fn scratch_dir(app: &AppHandle) -> Option<PathBuf> { hip_subdir(app, "scratch") }

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
