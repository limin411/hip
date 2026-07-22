//! Project workspace file search for composer `@` mentions.
//!
//! Walk is bounded (visit cap + soft time budget) and runs under `spawn_blocking`.
//! Empty query returns no hits (hint-only UX on the frontend).

use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_VISIT: usize = 8000;
const TIME_BUDGET: Duration = Duration::from_millis(80);
const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 100;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    "coverage",
    "__pycache__",
    ".turbo",
    ".cache",
    "vendor",
    ".venv",
    "venv",
    "Pods",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileSearchHit {
    pub relative_path: String,
    pub absolute_path: String,
    pub name: String,
    pub is_dir: bool,
    pub score: i32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileSearchResult {
    pub root: String,
    pub query: String,
    pub hits: Vec<WorkspaceFileSearchHit>,
    pub truncated: bool,
}

fn path_is_within(root: &Path, target: &Path) -> bool {
    target.starts_with(root)
}

fn to_posix_rel(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Single best score (min tier). None = drop.
pub fn score_path(q: &str, basename: &str, rel: &str) -> Option<i32> {
    if q.is_empty() {
        return None;
    }
    let b = basename.to_lowercase();
    let r = rel.to_lowercase();
    if b.starts_with(q) {
        return Some(0);
    }
    if b.contains(q) {
        return Some(1);
    }
    if r.split('/').any(|seg| seg.starts_with(q)) {
        return Some(1);
    }
    if r.contains(q) {
        return Some(2);
    }
    None
}

fn is_skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|d| *d == name)
}

/// Pure search over an already-canonicalized absolute directory root.
pub fn search_workspace_files(
    root: &str,
    query: &str,
    limit: usize,
    include_dirs: bool,
) -> Result<WorkspaceFileSearchResult, String> {
    let q_raw = query.trim();
    let limit = limit.clamp(1, MAX_LIMIT);

    if q_raw.is_empty() {
        return Ok(WorkspaceFileSearchResult {
            root: root.to_string(),
            query: query.to_string(),
            hits: vec![],
            truncated: false,
        });
    }

    if root.contains('\0') {
        return Err("root contains NUL".into());
    }
    let root_path = Path::new(root);
    if !root_path.is_absolute() {
        return Err("root must be an absolute path".into());
    }

    let real_root = root_path
        .canonicalize()
        .map_err(|e| format!("root not accessible: {e}"))?;
    if !real_root.is_dir() {
        return Err("root is not a directory".into());
    }

    let q = q_raw.to_lowercase().replace('\\', "/");
    let deadline = Instant::now() + TIME_BUDGET;
    let mut visited = 0usize;
    let mut truncated = false;
    let mut candidates: Vec<WorkspaceFileSearchHit> = Vec::new();

    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(real_root.clone());

    while let Some(dir) = queue.pop_front() {
        if Instant::now() > deadline || visited >= MAX_VISIT {
            truncated = true;
            break;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if Instant::now() > deadline || visited >= MAX_VISIT {
                truncated = true;
                break;
            }
            visited += 1;

            let name_os = entry.file_name();
            let name = name_os.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }

            let path = entry.path();
            // Skip all symlinks (files + dirs) — no follow.
            let ft = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                continue;
            }

            // Lexical within check (no symlink escape).
            if !path_is_within(&real_root, &path) {
                continue;
            }

            let Some(rel) = to_posix_rel(&real_root, &path) else {
                continue;
            };

            if ft.is_dir() {
                if is_skip_dir(name.as_ref()) {
                    continue;
                }
                if include_dirs {
                    if let Some(score) = score_path(&q, name.as_ref(), &rel) {
                        candidates.push(WorkspaceFileSearchHit {
                            relative_path: rel.clone(),
                            absolute_path: path.to_string_lossy().into_owned(),
                            name: name.into_owned(),
                            is_dir: true,
                            score,
                        });
                    }
                }
                queue.push_back(path);
            } else if ft.is_file() {
                if let Some(score) = score_path(&q, name.as_ref(), &rel) {
                    candidates.push(WorkspaceFileSearchHit {
                        relative_path: rel,
                        absolute_path: path.to_string_lossy().into_owned(),
                        name: name.into_owned(),
                        is_dir: false,
                        score,
                    });
                }
            }
        }
    }

    candidates.sort_by(|a, b| {
        a.score
            .cmp(&b.score)
            .then_with(|| a.relative_path.len().cmp(&b.relative_path.len()))
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    candidates.truncate(limit);

    Ok(WorkspaceFileSearchResult {
        root: real_root.to_string_lossy().into_owned(),
        query: query.to_string(),
        hits: candidates,
        truncated,
    })
}

#[tauri::command]
pub async fn workspace_file_search(
    root: String,
    query: String,
    limit: Option<usize>,
    include_dirs: Option<bool>,
) -> Result<WorkspaceFileSearchResult, String> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let include_dirs = include_dirs.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        search_workspace_files(&root, &query, limit, include_dirs)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{create_dir_all, File};
    use std::io::Write;

    fn write_file(p: &Path) {
        if let Some(parent) = p.parent() {
            create_dir_all(parent).unwrap();
        }
        File::create(p).unwrap().write_all(b"x").unwrap();
    }

    #[test]
    fn score_path_tiers() {
        assert_eq!(score_path("foo", "foo.ts", "foo.ts"), Some(0));
        assert_eq!(score_path("foo", "foobar.ts", "lib/foobar.ts"), Some(0));
        assert_eq!(score_path("foo", "afoo.ts", "x/afoo.ts"), Some(1));
        assert_eq!(score_path("foo", "bar.ts", "src/foo/bar.ts"), Some(1));
        assert_eq!(score_path("src/fo", "foo.ts", "src/foo.ts"), Some(2));
        assert_eq!(score_path("zzz", "a.ts", "a.ts"), None);
    }

    #[test]
    fn empty_query_no_hits() {
        let dir = tempfile_dir();
        let r = search_workspace_files(dir.to_str().unwrap(), "", 50, true).unwrap();
        assert!(r.hits.is_empty());
        assert!(!r.truncated);
    }

    #[test]
    fn ranks_foo_fixture() {
        let dir = tempfile_dir();
        write_file(&dir.join("foo.ts"));
        write_file(&dir.join("lib/foobar.ts"));
        write_file(&dir.join("x/afoo.ts"));
        write_file(&dir.join("src/foo/bar.ts"));

        let r = search_workspace_files(dir.to_str().unwrap(), "foo", 50, false).unwrap();
        let paths: Vec<_> = r.hits.iter().map(|h| h.relative_path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["foo.ts", "lib/foobar.ts", "x/afoo.ts", "src/foo/bar.ts"]
        );
    }

    #[test]
    fn ranks_score1_only_set() {
        let dir = tempfile_dir();
        write_file(&dir.join("myfoo.ts"));
        write_file(&dir.join("x/afoo.ts"));
        write_file(&dir.join("src/foo/bar.ts"));

        let r = search_workspace_files(dir.to_str().unwrap(), "foo", 50, false).unwrap();
        let paths: Vec<_> = r.hits.iter().map(|h| h.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["myfoo.ts", "x/afoo.ts", "src/foo/bar.ts"]);
    }

    #[test]
    fn ranks_src_fo_contains() {
        let dir = tempfile_dir();
        write_file(&dir.join("src/foo.ts"));
        write_file(&dir.join("src/food/a.ts"));
        write_file(&dir.join("lib/src/fo.ts"));

        let r = search_workspace_files(dir.to_str().unwrap(), "src/fo", 50, false).unwrap();
        let paths: Vec<_> = r.hits.iter().map(|h| h.relative_path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["src/foo.ts", "lib/src/fo.ts", "src/food/a.ts"]
        );
    }

    #[test]
    fn skips_node_modules() {
        let dir = tempfile_dir();
        write_file(&dir.join("app.ts"));
        write_file(&dir.join("node_modules/pkg/index.js"));

        let r = search_workspace_files(dir.to_str().unwrap(), "index", 50, false).unwrap();
        assert!(r.hits.iter().all(|h| !h.relative_path.contains("node_modules")));
        let r2 = search_workspace_files(dir.to_str().unwrap(), "app", 50, false).unwrap();
        assert!(r2.hits.iter().any(|h| h.relative_path == "app.ts"));
    }

    #[test]
    fn rejects_non_absolute_root() {
        let err = search_workspace_files("relative", "x", 10, true).unwrap_err();
        assert!(err.contains("absolute"));
    }

    #[test]
    fn limit_clamps_results() {
        let dir = tempfile_dir();
        for i in 0..20 {
            write_file(&dir.join(format!("file{i}.ts")));
        }
        let r = search_workspace_files(dir.to_str().unwrap(), "file", 5, false).unwrap();
        assert!(r.hits.len() <= 5);
    }

    fn tempfile_dir() -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let base = std::env::temp_dir().join(format!("hip-wfs-{}-{}", std::process::id(), n));
        create_dir_all(&base).unwrap();
        base
    }
}
