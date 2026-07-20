//! Pure remote-path sanitization for SFTP (no session / network).
//!
//! See `docs/design/2026-07-20-terminal-management.md` § SFTP security algorithm.
//!
//! `sanitize_remote_path` is unit-tested without a session. Callers that need
//! home/cwd resolution pass the `"."` sentinel through `sftp.canonicalize`.

/// Max remote path length (bytes) we accept on the wire.
pub const MAX_REMOTE_PATH_LEN: usize = 4096;

/// Pure sanitize for remote SFTP paths.
///
/// Rules:
/// 1. Empty / `"."` / `"./"` → `Ok(".")` (caller must realpath via SFTP).
/// 2. Reject NUL; normalize `\` → `/`; collapse consecutive `/`.
/// 3. Reject any segment `..`; reject intermediate segment `.`.
/// 4. Cap length at [`MAX_REMOTE_PATH_LEN`].
/// 5. Relative paths are returned as sanitized relative strings (caller realpaths).
/// 6. Absolute paths keep a single leading `/`.
pub fn sanitize_remote_path(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    // Special-cases BEFORE segment sanitization — home / session cwd.
    if trimmed.is_empty() || trimmed == "." || trimmed == "./" {
        return Ok(".".to_string());
    }

    if trimmed.contains('\0') {
        return Err("remote path contains NUL".into());
    }
    // Soft pre-check (generous) so we fail fast on absurd inputs; final length
    // is enforced after slash collapse / segment drop (Issue 10).
    if trimmed.len() > MAX_REMOTE_PATH_LEN * 2 {
        return Err(format!(
            "remote path exceeds max length ({MAX_REMOTE_PATH_LEN})"
        ));
    }

    // Normalize separators.
    let mut s = trimmed.replace('\\', "/");
    while s.contains("//") {
        s = s.replace("//", "/");
    }

    let absolute = s.starts_with('/');
    // Split, dropping empty segments from leading/trailing slashes.
    let segments: Vec<&str> = s.split('/').filter(|p| !p.is_empty()).collect();

    let mut out: Vec<&str> = Vec::with_capacity(segments.len());
    for seg in segments.iter() {
        if *seg == ".." {
            return Err("remote path must not contain '..' segments".into());
        }
        if *seg == "." {
            // Allow only as the whole-path special case handled above.
            // Intermediate `.` (e.g. `foo/./bar`) is rejected.
            return Err("remote path must not contain intermediate '.' segments".into());
        }
        out.push(seg);
    }

    if out.is_empty() {
        // Input was only slashes (e.g. "/" or "///") — absolute root.
        if absolute {
            return Ok("/".to_string());
        }
        return Ok(".".to_string());
    }

    let joined = out.join("/");
    let result = if absolute {
        format!("/{joined}")
    } else {
        joined
    };
    if result.len() > MAX_REMOTE_PATH_LEN {
        return Err(format!(
            "remote path exceeds max length ({MAX_REMOTE_PATH_LEN})"
        ));
    }
    Ok(result)
}

/// Join a parent directory and a file name with `/` (POSIX / SFTP wire style).
pub fn join_remote(parent: &str, name: &str) -> String {
    let name = name.trim_matches('/');
    if parent.is_empty() || parent == "." {
        return name.to_string();
    }
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// Basename of a remote path (last `/`-separated segment).
pub fn remote_basename(path: &str) -> &str {
    let p = path.trim_end_matches('/');
    p.rsplit('/').next().unwrap_or(p)
}

/// Parent directory of a remote path (`/` for root children; `"."` for relative single segment).
pub fn remote_parent(path: &str) -> String {
    let p = path.trim_end_matches('/');
    match p.rfind('/') {
        Some(0) => "/".to_string(),
        Some(i) => p[..i].to_string(),
        None => ".".to_string(),
    }
}

/// Sibling partial path: `.<basename>.hip-sftp-partial-<safe_op>` in the same directory.
pub fn remote_temp_path(dest: &str, op_id: &str) -> String {
    let base = remote_basename(dest);
    let parent = remote_parent(dest);
    let safe_op: String = op_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(32)
        .collect();
    join_remote(&parent, &format!(".{base}.hip-sftp-partial-{safe_op}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_dot_are_sentinel() {
        assert_eq!(sanitize_remote_path("").unwrap(), ".");
        assert_eq!(sanitize_remote_path("   ").unwrap(), ".");
        assert_eq!(sanitize_remote_path(".").unwrap(), ".");
        assert_eq!(sanitize_remote_path("./").unwrap(), ".");
        assert_eq!(sanitize_remote_path(" . ").unwrap(), ".");
    }

    #[test]
    fn rejects_dotdot_anywhere() {
        assert!(sanitize_remote_path("..").is_err());
        assert!(sanitize_remote_path("../etc/passwd").is_err());
        assert!(sanitize_remote_path("/home/../etc").is_err());
        assert!(sanitize_remote_path("foo/../../bar").is_err());
        assert!(sanitize_remote_path("foo/..").is_err());
    }

    #[test]
    fn rejects_intermediate_dot() {
        assert!(sanitize_remote_path("foo/./bar").is_err());
        assert!(sanitize_remote_path("./foo").is_err());
        assert!(sanitize_remote_path("foo/.").is_err());
    }

    #[test]
    fn rejects_nul() {
        assert!(sanitize_remote_path("foo\0bar").is_err());
    }

    #[test]
    fn normalizes_backslash_and_slashes() {
        assert_eq!(
            sanitize_remote_path("foo\\bar\\baz").unwrap(),
            "foo/bar/baz"
        );
        assert_eq!(sanitize_remote_path("a//b///c").unwrap(), "a/b/c");
        assert_eq!(sanitize_remote_path("/a//b/").unwrap(), "/a/b");
    }

    #[test]
    fn absolute_and_relative() {
        assert_eq!(sanitize_remote_path("/home/user").unwrap(), "/home/user");
        assert_eq!(sanitize_remote_path("relative/path").unwrap(), "relative/path");
        assert_eq!(sanitize_remote_path("/").unwrap(), "/");
        assert_eq!(sanitize_remote_path("///").unwrap(), "/");
    }

    #[test]
    fn rejects_too_long() {
        let long = "a".repeat(MAX_REMOTE_PATH_LEN + 1);
        assert!(sanitize_remote_path(&long).is_err());
        let ok = "a".repeat(MAX_REMOTE_PATH_LEN);
        assert!(sanitize_remote_path(&ok).is_ok());
    }

    #[test]
    fn join_and_basename() {
        assert_eq!(join_remote("/home/u", "f.txt"), "/home/u/f.txt");
        assert_eq!(join_remote("/home/u/", "f.txt"), "/home/u/f.txt");
        assert_eq!(join_remote(".", "f.txt"), "f.txt");
        assert_eq!(remote_basename("/a/b/c.txt"), "c.txt");
        assert_eq!(remote_basename("/a/b/"), "b");
        assert_eq!(remote_parent("/a/b/c.txt"), "/a/b");
        assert_eq!(remote_parent("/c.txt"), "/");
        assert_eq!(remote_parent("rel"), ".");
        let tmp = remote_temp_path("/home/u/f.txt", "sftp_ab-cd!");
        assert_eq!(tmp, "/home/u/.f.txt.hip-sftp-partial-sftp_ab-cd_");
    }

    #[test]
    fn length_checked_after_collapse() {
        // Redundant slashes: over soft raw limit is fine if normalized fits.
        let many_slashes = format!("/{}", "a/".repeat(10));
        assert!(sanitize_remote_path(&many_slashes).is_ok());
        // Normalized form over max is rejected.
        let long = format!("/{}", "a".repeat(MAX_REMOTE_PATH_LEN));
        assert!(sanitize_remote_path(&long).is_err());
    }
}
