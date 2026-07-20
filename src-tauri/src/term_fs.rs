//! Local managed-terminal file tree (`term_fs_ls`).
//!
//! Algorithm (design § Local `term_fs_ls`):
//! 1. Root = launch cwd of the managed local PTY session (`tm_*` only).
//! 2. Resolve target under root (empty / `.` / `./` → root).
//! 3. Lexical jail for relative paths (reject `..` that leave root).
//! 4. Symlink policy: `canonicalize` (realpath) both root and target; real target
//!    must stay under real root. Absolute inputs (including the non-canonical form of
//!    the root itself, e.g. macOS `/tmp` vs `/private/tmp`) are canonicalized
//!    **before** the within check so launch-cwd strings that realpath rewrites still work.
//! 5. readdir; hide dotfiles/dot-dirs; dirs first, then name.
//!    Symlink-to-dir entries are classified as directories (metadata follows the link);
//!    expanding them still runs `resolve_real_within` (escape links rejected).
//!
//! No call without an open managed local session (session map entry after `pty_open`).
//! Changing root requires a new terminal (or restart with a different cwd).

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::State;

use crate::pty::PtyManager;

// ── Wire types ──────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermFsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermFsLsResult {
    /// Canonical absolute directory that was listed.
    pub path: String,
    pub entries: Vec<TermFsEntry>,
}

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/// Separator-aware "target is root or under root".
pub fn path_is_within(root: &Path, target: &Path) -> bool {
    target.starts_with(root)
}

/// Join `path` onto `root` without resolving `..` escapes via component walk.
/// Absolute `path` is taken as-is (caller must canonicalize + within-check).
pub fn join_under_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == "./" {
        return Ok(root.to_path_buf());
    }
    if trimmed.contains('\0') {
        return Err("path contains NUL".into());
    }

    let p = Path::new(trimmed);
    if p.is_absolute() {
        return Ok(p.to_path_buf());
    }

    // Walk components; reject `..` that would leave root lexically.
    let mut out = root.to_path_buf();
    for comp in p.components() {
        match comp {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.starts_with(root) || out.as_os_str() == root.as_os_str() {
                    return Err("path escapes terminal root".into());
                }
                // Pop one level but never above root.
                if !out.pop() {
                    return Err("path escapes terminal root".into());
                }
                if !out.starts_with(root) {
                    return Err("path escapes terminal root".into());
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                // Relative path shouldn't contain these after is_absolute check.
                return Err("invalid relative path".into());
            }
        }
    }
    if !path_is_within(root, &out) {
        return Err("path escapes terminal root".into());
    }
    Ok(out)
}

/// Lexical join + canonicalize (symlink-aware realpath) jail under `root`.
///
/// Symlink / non-canon policy:
/// - Always canonicalize the root first.
/// - Absolute path strings (e.g. the UI-seeded launch cwd `/tmp/...`) may differ
///   from `root_canon` (`/private/tmp/...` on macOS). Those are **not** rejected
///   before canonicalize; we realpath the target first, then `path_is_within`.
/// - Relative paths still get a lexical join under `root_canon` (rejects `..`).
/// - If the target does not exist, only a post-join lexical check applies.
pub fn resolve_real_within(root: &Path, path: &str) -> Result<PathBuf, String> {
    let root_canon = root
        .canonicalize()
        .map_err(|e| format!("terminal root not accessible: {e}"))?;

    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == "./" {
        return Ok(root_canon);
    }

    let joined = join_under_root(&root_canon, path)?;

    // Prefer canonicalize-then-within so absolute non-canon forms of the root
    // (and of in-tree paths) succeed. Do **not** reject absolute targets solely
    // because they fail path_is_within before realpath (macOS /tmp vs /private/tmp).
    match joined.canonicalize() {
        Ok(real_target) => {
            if !path_is_within(&root_canon, &real_target) {
                // Distinguish escape-via-symlink from plain outside absolute path.
                if joined.is_absolute() && !path_is_within(&root_canon, &joined) {
                    // Absolute wire path that realpaths outside root.
                    return Err("path escapes terminal root".into());
                }
                return Err("path escapes terminal root via symlink".into());
            }
            Ok(real_target)
        }
        Err(_) => {
            // Missing path: lexical jail only (no realpath).
            // Absolute non-canon forms of an existing root cannot hit this arm
            // for the root itself (root exists). Nested missing paths under a
            // non-canon absolute base may fail if the base doesn't start with
            // root_canon — callers should prefer relative paths / "." for ls.
            if !path_is_within(&root_canon, &joined) {
                return Err("path escapes terminal root".into());
            }
            Ok(joined)
        }
    }
}

/// List immediate children (non-recursive). Hides dotfiles; dirs first.
///
/// Symlink-to-dir: classified as a directory via following `metadata` so the
/// tree can expand. Expand still goes through `resolve_real_within` (escape
/// links are rejected at list time for that path).
pub fn ls_dir_entries(dir: &Path) -> Result<Vec<TermFsEntry>, String> {
    let meta = std::fs::metadata(dir).map_err(|e| format!("path not accessible: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }

    let read = std::fs::read_dir(dir).map_err(|e| format!("readdir failed: {e}"))?;
    let mut entries: Vec<TermFsEntry> = Vec::new();
    for ent in read {
        let ent = ent.map_err(|e| format!("readdir entry failed: {e}"))?;
        let name = ent.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." {
            continue;
        }
        // Match workspace-fs / SFTP: hide dotfiles and dot-dirs.
        if name.starts_with('.') {
            continue;
        }
        let full = ent.path();
        // Follow symlinks for classification so symlink→dir is expandable.
        // Falls back to DirEntry file_type when metadata fails.
        let followed = std::fs::metadata(&full).ok();
        let is_dir = followed
            .as_ref()
            .map(|m| m.is_dir())
            .unwrap_or_else(|| {
                ent.file_type()
                    .map(|ft| ft.is_dir())
                    .unwrap_or(false)
            });
        let size = if is_dir {
            None
        } else {
            followed.map(|m| m.len()).or_else(|| ent.metadata().ok().map(|m| m.len()))
        };
        entries.push(TermFsEntry {
            name,
            path: full.to_string_lossy().into_owned(),
            is_dir,
            size,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

// ── Command ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn term_fs_ls(
    state: State<'_, PtyManager>,
    terminal_id: String,
    path: String,
) -> Result<TermFsLsResult, String> {
    if terminal_id.is_empty() || !terminal_id.starts_with("tm_") {
        return Err("term_fs_ls requires managed terminal id (tm_*)".into());
    }
    let root = state
        .launch_cwd(&terminal_id)
        .ok_or_else(|| "no local terminal session for term_fs_ls".to_string())?;

    let dir = resolve_real_within(&root, &path)?;
    let entries = ls_dir_entries(&dir)?;
    Ok(TermFsLsResult {
        path: dir.to_string_lossy().into_owned(),
        entries,
    })
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    struct TmpTree {
        root: PathBuf,
    }

    impl Drop for TmpTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn tmp_tree() -> TmpTree {
        let root = std::env::temp_dir().join(format!(
            "hip-term-fs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sub").join("nested")).unwrap();
        let mut f = fs::File::create(root.join("a.txt")).unwrap();
        write!(f, "hi").unwrap();
        let mut f2 = fs::File::create(root.join("sub").join("b.txt")).unwrap();
        write!(f2, "yo").unwrap();
        let mut dot = fs::File::create(root.join(".hidden")).unwrap();
        write!(dot, "x").unwrap();
        TmpTree { root }
    }

    #[test]
    fn path_is_within_root_and_child() {
        let root = PathBuf::from("/tmp/term-root");
        assert!(path_is_within(&root, &root));
        assert!(path_is_within(&root, &root.join("a")));
        assert!(!path_is_within(&root, Path::new("/tmp")));
        assert!(!path_is_within(&root, Path::new("/tmp/term-root-other")));
    }

    #[test]
    fn join_under_root_empty_and_dot() {
        let root = PathBuf::from("/tmp/r");
        assert_eq!(join_under_root(&root, "").unwrap(), root);
        assert_eq!(join_under_root(&root, ".").unwrap(), root);
        assert_eq!(join_under_root(&root, "./").unwrap(), root);
    }

    #[test]
    fn join_under_root_rejects_parent_escape() {
        let root = PathBuf::from("/tmp/r");
        let err = join_under_root(&root, "..").unwrap_err();
        assert!(err.contains("escapes"), "{err}");
        let err2 = join_under_root(&root, "a/../../outside").unwrap_err();
        assert!(err2.contains("escapes"), "{err2}");
    }

    #[test]
    fn join_under_root_relative_ok() {
        let root = PathBuf::from("/tmp/r");
        let got = join_under_root(&root, "sub/nested").unwrap();
        assert_eq!(got, root.join("sub").join("nested"));
    }

    #[test]
    fn resolve_real_within_lists_root() {
        let tree = tmp_tree();
        let got = resolve_real_within(&tree.root, "").unwrap();
        assert_eq!(got, tree.root.canonicalize().unwrap());
    }

    #[test]
    fn resolve_real_within_accepts_absolute_non_canon_root() {
        // Regression: launch cwd is often non-canonical (macOS `/tmp` → `/private/tmp`,
        // or the path string equal to the stored root before realpath). Listing with
        // that absolute string must succeed after canonicalize-then-within.
        let tree = tmp_tree();
        let non_canon = tree.root.clone(); // may already be under /var/folders or /tmp
        let as_wire = non_canon.to_string_lossy().into_owned();
        // Path equal to the stored root (what the UI used to pass as initialPath).
        let got = resolve_real_within(&non_canon, &as_wire).unwrap();
        assert_eq!(got, non_canon.canonicalize().unwrap());

        // Explicit /tmp style when available on this host.
        #[cfg(unix)]
        {
            let tmp_base = PathBuf::from("/tmp");
            if tmp_base.exists() {
                let name = format!(
                    "hip-term-fs-abs-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_nanos())
                        .unwrap_or(0)
                );
                let via_tmp = tmp_base.join(&name);
                let _ = fs::remove_dir_all(&via_tmp);
                fs::create_dir_all(&via_tmp).unwrap();
                let wire = via_tmp.to_string_lossy().into_owned();
                // root stored as /tmp/... while realpath is /private/tmp/...
                let got = resolve_real_within(&via_tmp, &wire).unwrap();
                assert_eq!(got, via_tmp.canonicalize().unwrap());
                // Also path="." still works with non-canon root.
                let got_dot = resolve_real_within(&via_tmp, ".").unwrap();
                assert_eq!(got_dot, via_tmp.canonicalize().unwrap());
                let _ = fs::remove_dir_all(&via_tmp);
            }
        }
    }

    #[test]
    fn resolve_real_within_rejects_absolute_escape() {
        let tree = tmp_tree();
        let outside = tree
            .root
            .parent()
            .unwrap()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let err = resolve_real_within(&tree.root, &outside).unwrap_err();
        assert!(err.contains("escapes"), "{err}");
    }

    #[test]
    fn resolve_real_within_rejects_symlink_escape() {
        let tree = tmp_tree();
        let outside = tree.root.parent().unwrap().join(format!(
            "hip-term-fs-outside-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&outside).unwrap();
        let link = tree.root.join("escape-link");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            let err = resolve_real_within(&tree.root, "escape-link").unwrap_err();
            assert!(
                err.contains("escapes") || err.contains("symlink"),
                "{err}"
            );
            let _ = fs::remove_dir_all(&outside);
        }
        #[cfg(not(unix))]
        {
            let _ = (outside, link);
        }
    }

    #[test]
    fn ls_dir_entries_hides_dots_and_sorts() {
        let tree = tmp_tree();
        let entries = ls_dir_entries(&tree.root).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.iter().any(|n| n.starts_with('.')), "{names:?}");
        assert!(names.contains(&"sub"));
        assert!(names.contains(&"a.txt"));
        let sub_i = names.iter().position(|n| *n == "sub").unwrap();
        let file_i = names.iter().position(|n| *n == "a.txt").unwrap();
        assert!(sub_i < file_i);
    }

    #[test]
    fn ls_dir_entries_rejects_file() {
        let tree = tmp_tree();
        let err = ls_dir_entries(&tree.root.join("a.txt")).unwrap_err();
        assert!(err.contains("not a directory"), "{err}");
    }

    #[test]
    fn ls_dir_entries_follows_symlink_to_dir() {
        let tree = tmp_tree();
        #[cfg(unix)]
        {
            let link = tree.root.join("link-to-sub");
            std::os::unix::fs::symlink(tree.root.join("sub"), &link).unwrap();
            let entries = ls_dir_entries(&tree.root).unwrap();
            let link_ent = entries.iter().find(|e| e.name == "link-to-sub").unwrap();
            assert!(
                link_ent.is_dir,
                "symlink→dir should be classified as directory for expand"
            );
        }
    }
}
