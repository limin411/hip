//! Pure helpers for skill install (zip-slip-safe extraction + slug derivation).
//! Kept separate from `lib.rs` so the path-sanitization logic is unit-testable.

use serde::{Deserialize, Serialize};
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

/// Mirrors the protocol `SkillMeta` shape (camelCase over the wire to the renderer).
/// Serialized as the JSON array returned by `list_skills`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub dir: String,
    pub has_scripts: bool,
}

/// The subset of `SKILL.md` YAML frontmatter we read. Extra keys are ignored.
#[derive(Deserialize)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
}

/// Parse the leading `---\n...\n---` YAML block of a `SKILL.md` body.
/// Returns `None` when there is no frontmatter or the YAML is invalid.
pub fn parse_frontmatter(body: &str) -> Option<Frontmatter> {
    let rest = body
        .strip_prefix("---\n")
        .or_else(|| body.strip_prefix("---\r\n"))?;
    // Closing fence at the start of a line: a `\n---` after the YAML, or an
    // immediate `---` (empty frontmatter block).
    let end = rest
        .find("\n---")
        .map(|i| i + 1)
        .or_else(|| if rest.starts_with("---") { Some(0) } else { None })?;
    let yaml = &rest[..end];
    serde_yaml::from_str::<Frontmatter>(yaml).ok()
}

/// Scan `<root>/*/SKILL.md`, parse frontmatter, and build a `SkillMeta` per valid
/// skill. Directories without a parseable `SKILL.md` (or missing a `name`) are
/// skipped. Never panics; a missing/unreadable root yields an empty list.
pub fn scan_skills(root: &Path) -> Vec<SkillMeta> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let skill_md = dir.join("SKILL.md");
        let body = match std::fs::read_to_string(&skill_md) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let fm = match parse_frontmatter(&body) {
            Some(f) => f,
            None => continue,
        };
        let name = match fm.name {
            Some(n) if !n.trim().is_empty() => n,
            _ => continue,
        };
        let id = match dir.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let has_scripts = dir.join("scripts").is_dir();
        out.push(SkillMeta {
            id,
            name,
            description: fm.description.unwrap_or_default(),
            dir: dir.to_string_lossy().into_owned(),
            has_scripts,
        });
    }
    out
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

    #[test]
    fn parse_frontmatter_reads_name_and_description() {
        let md = "---\nname: PDF Tools\ndescription: Work with PDFs\nextra: ignored\n---\n# Body\nhello\n";
        let fm = super::parse_frontmatter(md).unwrap();
        assert_eq!(fm.name.as_deref(), Some("PDF Tools"));
        assert_eq!(fm.description.as_deref(), Some("Work with PDFs"));
    }

    #[test]
    fn parse_frontmatter_none_without_fences() {
        assert!(super::parse_frontmatter("# Just a heading\nno frontmatter").is_none());
    }

    #[test]
    fn scan_skills_lists_valid_dirs_and_flags_scripts() {
        let root = std::env::temp_dir()
            .join(format!("hip-skills-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // Valid skill with a scripts/ dir.
        let a = root.join("pdf-tools");
        std::fs::create_dir_all(a.join("scripts")).unwrap();
        std::fs::write(
            a.join("SKILL.md"),
            "---\nname: PDF Tools\ndescription: Work with PDFs\n---\nbody",
        )
        .unwrap();
        std::fs::write(a.join("scripts").join("run.sh"), "echo hi").unwrap();
        // Valid skill, no scripts.
        let b = root.join("notes");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(
            b.join("SKILL.md"),
            "---\nname: Notes\ndescription: Take notes\n---\nbody",
        )
        .unwrap();
        // A non-skill dir (no SKILL.md) — must be skipped.
        std::fs::create_dir_all(root.join("junk")).unwrap();

        let mut metas = super::scan_skills(&root);
        metas.sort_by(|x, y| x.id.cmp(&y.id));
        assert_eq!(metas.len(), 2);
        let notes = metas.iter().find(|m| m.id == "notes").unwrap();
        assert_eq!(notes.name, "Notes");
        assert_eq!(notes.description, "Take notes");
        assert!(!notes.has_scripts);
        let pdf = metas.iter().find(|m| m.id == "pdf-tools").unwrap();
        assert_eq!(pdf.name, "PDF Tools");
        assert!(pdf.has_scripts);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_skills_missing_root_is_empty() {
        let root = std::env::temp_dir().join("hip-skills-does-not-exist-xyz");
        let _ = std::fs::remove_dir_all(&root);
        assert!(super::scan_skills(&root).is_empty());
    }
}
