//! Local managed-terminal file tree (`term_fs_ls`).
//!
//! Algorithm (design § Local `term_fs_ls`):
//! 1. Root = launch cwd of the managed local PTY session (`tm_*` only).
//! 2. Resolve target under root (empty / `.` / `./` → root).
//! 3. Lexical jail: resolved path must stay under root.
//! 4. Symlink policy: `canonicalize` (realpath) both root and target; real target
//!    must stay under real root. Closes in-tree symlink escapes (workspace-fs parity).
//! 5. readdir; hide dotfiles/dot-dirs; dirs first, then name.
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
/// Absolute `path` is taken as-is (still checked by caller).
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
/// Symlink policy: if the target exists, `canonicalize` follows all symlinks;
/// the real path must remain under the real root. If the target does not exist
/// yet, only the lexical check applies (ls of missing path will fail later).
pub fn resolve_real_within(root: &Path, path: &str) -> Result<PathBuf, String> {
    let root_canon = root.canonicalize().map_err(|e| {
        format!("terminal root not accessible: {e}")
    })?;

    let joined = join_under_root(&root_canon, path)?;
    if !path_is_within(&root_canon, &joined) {
        return Err("path escapes terminal root".into());
    }

    match joined.canonicalize() {
        Ok(real_target) => {
            if !path_is_within(&root_canon, &real_target) {
                return Err("path escapes terminal root via symlink".into());
            }
            Ok(real_target)
        }
        Err(_) => {
            // Missing path: keep lexical target if still under root.
            if !path_is_within(&root_canon, &joined) {
                return Err("path escapes terminal root".into());
            }
            Ok(joined)
        }
    }
}

/// List immediate children (non-recursive). Hides dotfiles; dirs first.
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
        let file_type = ent
            .file_type()
            .map_err(|e| format!("file_type failed: {e}"))?;
        let is_dir = file_type.is_dir();
        let size = if is_dir {
            None
        } else {
            ent.metadata().ok().map(|m| m.len())
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
}
