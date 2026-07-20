//! SSH-related pure path helpers (no russh dependency).

use std::path::PathBuf;

/// Expand a leading `~/` (or bare `~`) via `dirs::home_dir()`.
///
/// Absolute / relative paths without a tilde are returned unchanged.
/// Fails clearly when home is unknown and expansion is required.
pub fn expand_tilde_path(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("private key path is empty".to_string());
    }
    if path == "~" {
        return dirs::home_dir()
            .ok_or_else(|| "home directory unknown (cannot expand ~)".to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        let home = dirs::home_dir()
            .ok_or_else(|| "home directory unknown (cannot expand ~/)".to_string())?;
        return Ok(home.join(rest));
    }
    // Also support Windows-style ~\...
    if let Some(rest) = path.strip_prefix("~\\") {
        let home = dirs::home_dir()
            .ok_or_else(|| "home directory unknown (cannot expand ~\\)".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_empty_rejects() {
        assert!(expand_tilde_path("").is_err());
        assert!(expand_tilde_path("   ").is_err());
    }

    #[test]
    fn expand_absolute_unchanged() {
        let p = expand_tilde_path("/Users/me/.ssh/id_ed25519").unwrap();
        assert_eq!(p, PathBuf::from("/Users/me/.ssh/id_ed25519"));
    }

    #[test]
    fn expand_relative_unchanged() {
        let p = expand_tilde_path("keys/id_rsa").unwrap();
        assert_eq!(p, PathBuf::from("keys/id_rsa"));
    }

    #[test]
    fn expand_tilde_prefix() {
        // Only assert structure when home is available (CI always has HOME/USERPROFILE).
        if dirs::home_dir().is_none() {
            return;
        }
        let p = expand_tilde_path("~/.ssh/id_ed25519").unwrap();
        assert!(p.is_absolute(), "{p:?}");
        assert!(p.ends_with(".ssh/id_ed25519") || p.ends_with(".ssh\\id_ed25519"));
        let bare = expand_tilde_path("~").unwrap();
        assert_eq!(bare, dirs::home_dir().unwrap());
    }
}
