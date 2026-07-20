//! Shared durable file write: temp + rename, Unix mode `0o600`.
//!
//! Used by secret/config writers (`auth.json`, `terminal-hosts.json`, …)
//! so mode and crash semantics cannot drift between modules.

use std::io;
use std::path::Path;

/// Atomically replace `path` with `body`.
///
/// On Unix the temp file is created at `0o600` and re-asserted before rename
/// so a secrets/inventory file is never briefly world-readable (including when
/// a stale temp from a crash pre-existed with wider perms). On failure the
/// temp is removed. Caller is responsible for creating parent directories.
pub fn atomic_write_private(path: &Path, body: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");

    let write_and_rename = || -> io::Result<()> {
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)?;
            f.write_all(body)?;
            // `mode(0o600)` only applies when the file is created; re-assert in case
            // `tmp` pre-existed (stale from a crash) with wider perms.
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        #[cfg(not(unix))]
        {
            std::fs::write(&tmp, body)?;
        }
        std::fs::rename(&tmp, path)
    };

    let result = write_and_rename();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hip-atomic-write-test-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("file.json")
    }

    #[test]
    fn roundtrip_contents() {
        let p = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&p);
        atomic_write_private(&p, br#"{"ok":true}"#).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), r#"{"ok":true}"#);
    }

    #[test]
    #[cfg(unix)]
    fn file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        let _ = std::fs::remove_file(&p);
        atomic_write_private(&p, b"{}").unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    #[cfg(unix)]
    fn preexisting_wide_tmp_is_tightened() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("wide-tmp");
        let tmp = p.with_extension("tmp");
        std::fs::write(&tmp, "stale").unwrap();
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o644)).unwrap();
        atomic_write_private(&p, b"{\"n\":1}").unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert!(!tmp.exists());
    }
}
