//! Pure helpers for skill install (zip-slip-safe extraction + slug derivation).
//! Kept separate from `lib.rs` so the path-sanitization logic is unit-testable.

use std::path::{Component, Path, PathBuf};

/// Resolve a zip entry's relative path against `dest`, rejecting anything that
/// would escape `dest` (zip-slip). Returns `None` for absolute paths, paths with
/// a `..` component, or anything containing a Windows drive/root prefix.
pub fn safe_join(dest: &Path, entry: &str) -> Option<PathBuf> {
    let rel = Path::new(entry);
    let mut out = dest.to_path_buf();
    for comp in rel.components() {
        match comp {
            // Normal path segment — append it.
            Component::Normal(seg) => out.push(seg),
            // A bare `.` is harmless; skip it.
            Component::CurDir => {}
            // Anything that could escape the destination is rejected outright.
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// Derive a filesystem-safe kebab-case slug from a skill's frontmatter `name`.
/// Lowercases, maps non-alphanumerics to `-`, collapses runs, trims edges.
/// Falls back to `"skill"` when nothing usable remains.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "skill".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::{safe_join, slugify};
    use std::path::{Path, PathBuf};

    #[test]
    fn safe_join_allows_nested_normal_paths() {
        let dest = Path::new("/tmp/skills/my-skill");
        assert_eq!(
            safe_join(dest, "scripts/run.sh"),
            Some(PathBuf::from("/tmp/skills/my-skill/scripts/run.sh")),
        );
        assert_eq!(
            safe_join(dest, "SKILL.md"),
            Some(PathBuf::from("/tmp/skills/my-skill/SKILL.md")),
        );
        // A leading `./` is normalized away, not rejected.
        assert_eq!(
            safe_join(dest, "./SKILL.md"),
            Some(PathBuf::from("/tmp/skills/my-skill/SKILL.md")),
        );
    }

    #[test]
    fn safe_join_rejects_parent_traversal() {
        let dest = Path::new("/tmp/skills/my-skill");
        assert_eq!(safe_join(dest, "../evil.sh"), None);
        assert_eq!(safe_join(dest, "scripts/../../evil.sh"), None);
        assert_eq!(safe_join(dest, "a/../../b"), None);
    }

    #[test]
    fn safe_join_rejects_absolute_paths() {
        let dest = Path::new("/tmp/skills/my-skill");
        assert_eq!(safe_join(dest, "/etc/passwd"), None);
    }

    #[test]
    fn slugify_kebabs_and_trims() {
        assert_eq!(slugify("PDF Tools!"), "pdf-tools");
        assert_eq!(slugify("  Hello   World  "), "hello-world");
        assert_eq!(slugify("already-kebab"), "already-kebab");
        assert_eq!(slugify("!!!"), "skill");
    }
}
