use serde_json::{Map, Value};
use std::io;
use std::path::Path;

/// Read the auth map. A missing or corrupt file yields an empty map (never an error),
/// so a hand-deleted/garbled `auth.json` degrades to "no keys" rather than breaking the app.
fn read_auth_map(path: &Path) -> Map<String, Value> {
    match std::fs::read_to_string(path) {
        Ok(body) => serde_json::from_str::<Map<String, Value>>(&body).unwrap_or_default(),
        Err(_) => Map::new(),
    }
}

/// Write the auth map via shared atomic 0o600 helper (see `atomic_write`).
fn write_auth_map(path: &Path, map: &Map<String, Value>) -> io::Result<()> {
    let body = serde_json::to_string_pretty(map)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    crate::atomic_write::atomic_write_private(path, body.as_bytes())
}

/// True when `key` maps to a non-empty JSON string in the auth map.
/// Used by `has_secrets` / `has_secret_keys` so empty-string values do not count as configured.
pub fn auth_has_nonempty(map: &Map<String, Value>, key: &str) -> bool {
    map.get(key)
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
}

/// Read the entire auth map (single file read). Used by batch lookups like
/// `has_secrets` to avoid N sequential file reads per call.
pub fn auth_get_all(path: &Path) -> Map<String, Value> {
    read_auth_map(path)
}

/// Get one secret by key (key == the `HIP_MODEL_<ID>_API_KEY` env-var name).
pub fn auth_get(path: &Path, key: &str) -> Option<String> {
    read_auth_map(path)
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Insert/replace one secret and persist.
pub fn auth_set(path: &Path, key: &str, value: &str) -> io::Result<()> {
    let mut map = read_auth_map(path);
    map.insert(key.to_string(), Value::String(value.to_string()));
    write_auth_map(path, &map)
}

/// Remove one secret and persist. Skips the write entirely when the key was absent.
pub fn auth_delete(path: &Path, key: &str) -> io::Result<()> {
    let mut map = read_auth_map(path);
    if map.remove(key).is_some() {
        write_auth_map(path, &map)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hip-auth-test-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("auth.json")
    }

    #[test]
    fn set_get_delete_roundtrip() {
        let p = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&p);
        assert_eq!(auth_get(&p, "HIP_MODEL_DEEPSEEK_API_KEY"), None);

        auth_set(&p, "HIP_MODEL_DEEPSEEK_API_KEY", "sk-abc").unwrap();
        auth_set(&p, "HIP_MODEL_OPENAI_API_KEY", "sk-xyz").unwrap();
        assert_eq!(auth_get(&p, "HIP_MODEL_DEEPSEEK_API_KEY"), Some("sk-abc".to_string()));
        assert_eq!(auth_get(&p, "HIP_MODEL_OPENAI_API_KEY"), Some("sk-xyz".to_string()));

        auth_delete(&p, "HIP_MODEL_DEEPSEEK_API_KEY").unwrap();
        assert_eq!(auth_get(&p, "HIP_MODEL_DEEPSEEK_API_KEY"), None);
        // Deleting one key must not disturb the others.
        assert_eq!(auth_get(&p, "HIP_MODEL_OPENAI_API_KEY"), Some("sk-xyz".to_string()));
    }

    #[test]
    fn missing_file_reads_as_empty() {
        let p = std::env::temp_dir().join("hip-auth-does-not-exist-xyz.json");
        let _ = std::fs::remove_file(&p);
        assert_eq!(auth_get(&p, "anything"), None);
    }

    #[test]
    fn corrupt_file_reads_as_empty() {
        let p = tmp_path("corrupt");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        assert_eq!(auth_get(&p, "anything"), None);
    }

    #[test]
    fn auth_has_nonempty_rejects_empty_and_missing() {
        let mut map = Map::new();
        map.insert("K".into(), Value::String("v".into()));
        map.insert("EMPTY".into(), Value::String("".into()));
        map.insert("NUM".into(), Value::Number(1.into()));
        assert!(auth_has_nonempty(&map, "K"));
        assert!(!auth_has_nonempty(&map, "EMPTY"));
        assert!(!auth_has_nonempty(&map, "MISSING"));
        assert!(!auth_has_nonempty(&map, "NUM"));
    }

    #[test]
    #[cfg(unix)]
    fn file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        let _ = std::fs::remove_file(&p);
        auth_set(&p, "K", "v").unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    #[cfg(unix)]
    fn preexisting_wide_file_is_tightened() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("wide");
        std::fs::write(&p, "{}").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        auth_set(&p, "K", "v").unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
