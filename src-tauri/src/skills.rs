//! Pure helpers for skill install (zip-slip-safe extraction + slug derivation).
//! Kept separate from `lib.rs` so the path-sanitization logic is unit-testable.

use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

use crate::paths;

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

/// Named argument a skill accepts (frontmatter `arguments` list item).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillArgument {
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
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
    pub scope: String,
    // ── extended fields (mirrors TS SkillMeta) ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_invoke: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_invocable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<SkillArgument>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disable_shell_execution: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_references: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_assets: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

/// The subset of `SKILL.md` YAML frontmatter we read. Extra keys are ignored.
/// Accepts snake_case, kebab-case, and camelCase YAML keys via serde aliases.
#[derive(Deserialize)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    #[allow(dead_code)]
    pub scope: Option<String>,
    #[allow(dead_code)]
    #[serde(alias = "autoInvoke", alias = "auto-invoke")]
    pub auto_invoke: Option<bool>,
    #[allow(dead_code)]
    #[serde(alias = "userInvocable", alias = "user-invocable")]
    pub user_invocable: Option<bool>,
    #[allow(dead_code)]
    #[serde(alias = "allowedTools", alias = "allowed-tools")]
    pub allowed_tools: Option<Vec<String>>,
    #[allow(dead_code)]
    #[serde(alias = "disallowedTools", alias = "disallowed-tools")]
    pub disallowed_tools: Option<Vec<String>>,
    #[allow(dead_code)]
    pub context: Option<String>,
    #[allow(dead_code)]
    pub paths: Option<Vec<String>>,
    #[allow(dead_code)]
    pub model: Option<String>,
    #[allow(dead_code)]
    pub effort: Option<String>,
    #[allow(dead_code)]
    pub arguments: Option<Vec<SkillArgument>>,
    #[allow(dead_code)]
    pub shell: Option<String>,
    #[allow(dead_code)]
    #[serde(alias = "disableShellExecution", alias = "disable-shell-execution")]
    pub disable_shell_execution: Option<bool>,
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

/// Scan a single skill directory, parsing `SKILL.md` frontmatter for every
/// subdirectory. Directories without a parseable `SKILL.md` (or missing a `name`)
/// are skipped. Never panics; a missing/unreadable root yields an empty list.
fn scan_one_dir(root: &Path, scope: &str) -> Vec<SkillMeta> {
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
        let has_references = dir.join("references").is_dir();
        let has_assets = dir.join("assets").is_dir();
        out.push(SkillMeta {
            id,
            name,
            description: fm.description.unwrap_or_default(),
            dir: dir.to_string_lossy().into_owned(),
            has_scripts,
            scope: scope.to_string(),
            auto_invoke: fm.auto_invoke,
            user_invocable: fm.user_invocable,
            allowed_tools: fm.allowed_tools,
            disallowed_tools: fm.disallowed_tools,
            context: fm.context,
            paths: fm.paths,
            model: fm.model,
            effort: fm.effort,
            arguments: fm.arguments,
            shell: fm.shell,
            disable_shell_execution: fm.disable_shell_execution,
            has_references: Some(has_references),
            has_assets: Some(has_assets),
            plugin_id: None,
        });
    }
    out
}

#[cfg(test)]
/// Pure core: scan from explicit directories. Testable without AppHandle.
fn scan_skills_from_dirs(global_root: Option<&Path>, project_root: Option<&Path>) -> Vec<SkillMeta> {
    let mut metas: Vec<SkillMeta> = if let Some(dir) = global_root {
        scan_one_dir(dir, "global")
    } else {
        Vec::new()
    };

    if let Some(root) = project_root {
        let project_skills_dir = root.join(".hip").join("skills");
        let project = scan_one_dir(&project_skills_dir, "project");
        for ps in &project {
            metas.retain(|g| g.id != ps.id);
        }
        metas.extend(project);
    }

    metas.sort_by(|a, b| a.id.cmp(&b.id));
    metas
}

fn plugin_skill_paths(plugin_dir: &Path, manifest: &serde_json::Value) -> Vec<PathBuf> {
    match manifest.get("skills") {
        Some(serde_json::Value::String(s)) => vec![plugin_dir.join(s.as_str())],
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| plugin_dir.join(s)))
            .collect(),
        _ => Vec::new(),
    }
}

/// Discover plugin-contained skills by reading each `.plugin/plugin.json`.
fn scan_plugin_skills(plugins_dir: &Path) -> Vec<SkillMeta> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(plugins_dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }
        let plugin_id = plugin_dir
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());

        let manifest_path = plugin_dir.join(".plugin").join("plugin.json");
        let manifest_raw = match std::fs::read_to_string(&manifest_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let manifest: serde_json::Value = match serde_json::from_str(&manifest_raw) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let skill_paths = plugin_skill_paths(&plugin_dir, &manifest);
        let mut seen_parents = std::collections::HashSet::new();
        for skill_path in skill_paths {
            let parent = match skill_path.parent() {
                Some(p) => p.to_path_buf(),
                None => continue,
            };
            if !seen_parents.insert(parent.clone()) {
                continue;
            }
            let mut metas = scan_one_dir(&parent, "plugin");
            for m in &mut metas {
                m.plugin_id = plugin_id.clone();
            }
            out.extend(metas);
        }
    }
    out
}

pub fn find_plugin_skill_dir(plugins_dir: &Path, skill_id: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(plugins_dir).ok()?;
    for entry in entries.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }
        let manifest_path = plugin_dir.join(".plugin").join("plugin.json");
        let manifest_raw = std::fs::read_to_string(&manifest_path).ok()?;
        let manifest: serde_json::Value = serde_json::from_str(&manifest_raw).ok()?;

        for skill_path in plugin_skill_paths(&plugin_dir, &manifest) {
            if skill_path.file_name().and_then(|s| s.to_str()) == Some(skill_id) {
                return Some(skill_path);
            }
        }
    }
    None
}

/// Scan global, plugin, and optional project skill directories. Later scopes
/// override earlier ones by skill id.
pub fn scan_skills(app: &AppHandle, project_root: Option<&Path>) -> Vec<SkillMeta> {
    let mut metas = Vec::new();

    if let Some(global_dir) = paths::skills_dir(app) {
        metas.extend(scan_one_dir(&global_dir, "global"));
    }

    if let Some(plugins_dir) = paths::plugins_dir(app) {
        for pm in scan_plugin_skills(&plugins_dir) {
            metas.retain(|m| m.id != pm.id);
            metas.push(pm);
        }
    }

    if let Some(root) = project_root {
        let project_skills_dir = root.join(".hip").join("skills");
        for ps in scan_one_dir(&project_skills_dir, "project") {
            metas.retain(|m| m.id != ps.id);
            metas.push(ps);
        }
    }

    metas.sort_by(|a, b| a.id.cmp(&b.id));
    metas
}

/// Extract every entry of `zip_path` into `dest`, skipping any entry whose
/// resolved path would escape `dest` (zip-slip, via `safe_join`). Directory
/// entries create dirs; file entries create parent dirs then write bytes.
pub fn extract_zip(zip_path: &Path, dest: &Path) -> io::Result<()> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        let name = entry.name().to_string();
        let target = match safe_join(dest, &name) {
            Some(p) => p,
            None => continue, // zip-slip / absolute — skip silently.
        };
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&target)?;
        io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}

/// Find the directory that actually contains `SKILL.md`: either `dest` itself or
/// the single wrapping subfolder many archives add. Returns `None` if no
/// `SKILL.md` is found at either level.
pub fn find_skill_root(dest: &Path) -> Option<PathBuf> {
    if dest.join("SKILL.md").is_file() {
        return Some(dest.to_path_buf());
    }
    for entry in std::fs::read_dir(dest).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() && p.join("SKILL.md").is_file() {
            return Some(p);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{safe_join, slugify};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TID: AtomicUsize = AtomicUsize::new(0);
    fn unique_dir(label: &str) -> PathBuf {
        let n = TID.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("hip-{label}-{}-{n}", std::process::id()))
    }

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
    fn parse_frontmatter_reads_extended_fields() {
        let md = "\
---
name: PDF Tools
description: Work with PDFs
auto_invoke: true
user_invocable: false
allowed_tools:
  - read_file
  - write_file
disallowed_tools:
  - delete_file
context: fork
paths:
  - \"*.pdf\"
  - \"*.docx\"
model: claude-sonnet-4-20250514
effort: high
arguments:
  - name: input_file
    description: The input file path
    required: true
  - name: output_dir
    description: Where to save output
shell: bash
disable_shell_execution: true
---
# Body
";
        let fm = super::parse_frontmatter(md).unwrap();
        assert_eq!(fm.name.as_deref(), Some("PDF Tools"));
        assert_eq!(fm.description.as_deref(), Some("Work with PDFs"));
        assert_eq!(fm.auto_invoke, Some(true));
        assert_eq!(fm.user_invocable, Some(false));
        assert_eq!(
            fm.allowed_tools.as_deref(),
            Some(&["read_file".to_string(), "write_file".to_string()][..]),
        );
        assert_eq!(
            fm.disallowed_tools.as_deref(),
            Some(&["delete_file".to_string()][..]),
        );
        assert_eq!(fm.context.as_deref(), Some("fork"));
        assert_eq!(
            fm.paths.as_deref(),
            Some(&["*.pdf".to_string(), "*.docx".to_string()][..]),
        );
        assert_eq!(fm.model.as_deref(), Some("claude-sonnet-4-20250514"));
        assert_eq!(fm.effort.as_deref(), Some("high"));
        let args = fm.arguments.as_ref().unwrap();
        assert_eq!(args.len(), 2);
        assert_eq!(args[0].name, "input_file");
        assert_eq!(args[0].description, "The input file path");
        assert_eq!(args[0].required, Some(true));
        assert_eq!(args[1].name, "output_dir");
        assert_eq!(args[1].description, "Where to save output");
        assert_eq!(args[1].required, None); // not specified → None
        assert_eq!(fm.shell.as_deref(), Some("bash"));
        assert_eq!(fm.disable_shell_execution, Some(true));
    }

    #[test]
    fn parse_frontmatter_missing_fields_default_to_none() {
        let md = "---\nname: Minimal\ndescription: Just basics\n---\n# Body\n";
        let fm = super::parse_frontmatter(md).unwrap();
        assert_eq!(fm.name.as_deref(), Some("Minimal"));
        assert_eq!(fm.description.as_deref(), Some("Just basics"));
        assert!(fm.auto_invoke.is_none());
        assert!(fm.user_invocable.is_none());
        assert!(fm.allowed_tools.is_none());
        assert!(fm.disallowed_tools.is_none());
        assert!(fm.context.is_none());
        assert!(fm.paths.is_none());
        assert!(fm.model.is_none());
        assert!(fm.effort.is_none());
        assert!(fm.arguments.is_none());
        assert!(fm.shell.is_none());
        assert!(fm.disable_shell_execution.is_none());
    }

    #[test]
    fn scan_one_dir_reads_extended_fields_and_flags_dirs() {
        let root = unique_dir("skills-extended");
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("my-skill");
        std::fs::create_dir_all(dir.join("scripts")).unwrap();
        std::fs::create_dir_all(dir.join("references")).unwrap();
        // No assets/ dir — should be flagged as false.
        std::fs::write(
            dir.join("SKILL.md"),
            "\
---
name: Extended Skill
description: A skill with all fields
auto_invoke: false
user_invocable: true
allowed_tools:
  - read_file
context: inline
paths:
  - \"*.ts\"
model: gpt-5
effort: medium
shell: powershell
disable_shell_execution: false
---
body
",
        )
        .unwrap();

        let metas = super::scan_one_dir(&root, "global");
        assert_eq!(metas.len(), 1);
        let m = &metas[0];
        assert_eq!(m.id, "my-skill");
        assert_eq!(m.name, "Extended Skill");
        assert_eq!(m.description, "A skill with all fields");
        assert!(m.has_scripts);
        assert_eq!(m.scope, "global");
        assert_eq!(m.auto_invoke, Some(false));
        assert_eq!(m.user_invocable, Some(true));
        assert_eq!(
            m.allowed_tools.as_deref(),
            Some(&["read_file".to_string()][..]),
        );
        assert_eq!(m.context.as_deref(), Some("inline"));
        assert_eq!(
            m.paths.as_deref(),
            Some(&["*.ts".to_string()][..]),
        );
        assert_eq!(m.model.as_deref(), Some("gpt-5"));
        assert_eq!(m.effort.as_deref(), Some("medium"));
        assert_eq!(m.shell.as_deref(), Some("powershell"));
        assert_eq!(m.disable_shell_execution, Some(false));
        assert_eq!(m.has_references, Some(true));
        assert_eq!(m.has_assets, Some(false));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_one_dir_lists_valid_dirs_and_flags_scripts() {
        let root = unique_dir("skills-scan");
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

        let mut metas = super::scan_one_dir(&root, "global");
        metas.sort_by(|x, y| x.id.cmp(&y.id));
        assert_eq!(metas.len(), 2);
        let notes = metas.iter().find(|m| m.id == "notes").unwrap();
        assert_eq!(notes.name, "Notes");
        assert_eq!(notes.description, "Take notes");
        assert!(!notes.has_scripts);
        assert_eq!(notes.scope, "global");
        let pdf = metas.iter().find(|m| m.id == "pdf-tools").unwrap();
        assert_eq!(pdf.name, "PDF Tools");
        assert!(pdf.has_scripts);
        assert_eq!(pdf.scope, "global");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_one_dir_missing_root_is_empty() {
        let root = unique_dir("does-not-exist");
        let _ = std::fs::remove_dir_all(&root);
        assert!(super::scan_one_dir(&root, "global").is_empty());
    }

    /// Helper: write a minimal skill SKILL.md into a subdir of `root`.
    fn write_skill(root: &Path, id: &str, name: &str, description: &str) {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}\n---\nbody"),
        )
        .unwrap();
    }

    #[test]
    fn scan_skills_from_dirs_no_project_returns_only_global() {
        let global = unique_dir("skills-global");
        let _ = std::fs::remove_dir_all(&global);
        write_skill(&global, "pdf-tools", "PDF Tools", "Work with PDFs");
        write_skill(&global, "notes", "Notes", "Take notes");

        let metas = super::scan_skills_from_dirs(Some(&global), None);
        assert_eq!(metas.len(), 2);
        assert_eq!(metas[0].id, "notes");
        assert_eq!(metas[1].id, "pdf-tools");
        assert!(metas.iter().all(|m| m.scope == "global"));

        let _ = std::fs::remove_dir_all(&global);
    }

    #[test]
    fn scan_skills_from_dirs_project_empty_returns_only_global() {
        let global = unique_dir("skills-global");
        let _ = std::fs::remove_dir_all(&global);
        write_skill(&global, "pdf-tools", "PDF Tools", "Work with PDFs");

        // Project root exists but has no .hip/skills/ dir.
        let project = unique_dir("skills-project-empty");
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(&project).unwrap();

        let metas = super::scan_skills_from_dirs(Some(&global), Some(&project));
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].id, "pdf-tools");
        assert_eq!(metas[0].scope, "global");

        let _ = std::fs::remove_dir_all(&global);
        let _ = std::fs::remove_dir_all(&project);
    }

    #[test]
    fn scan_skills_from_dirs_project_overrides_global() {
        let global = unique_dir("skills-global");
        let _ = std::fs::remove_dir_all(&global);
        write_skill(&global, "pdf-tools", "PDF Tools (global)", "Global version");
        write_skill(&global, "notes", "Notes", "Take notes");

        let project = unique_dir("skills-project");
        let _ = std::fs::remove_dir_all(&project);
        let project_skills = project.join(".hip").join("skills");
        write_skill(&project_skills, "pdf-tools", "PDF Tools (project)", "Project override");
        // Also add a project-only skill.
        write_skill(&project_skills, "my-project-tool", "My Tool", "Project tool");

        let metas = super::scan_skills_from_dirs(Some(&global), Some(&project));
        // Expect: my-project-tool (project), notes (global), pdf-tools (project overrides global)
        assert_eq!(metas.len(), 3);
        assert_eq!(metas[0].id, "my-project-tool");
        assert_eq!(metas[0].scope, "project");
        assert_eq!(metas[1].id, "notes");
        assert_eq!(metas[1].scope, "global");
        assert_eq!(metas[2].id, "pdf-tools");
        assert_eq!(metas[2].scope, "project");
        assert_eq!(metas[2].name, "PDF Tools (project)");

        let _ = std::fs::remove_dir_all(&global);
        let _ = std::fs::remove_dir_all(&project);
    }

    fn make_zip(entries: &[(&str, &[u8])]) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hip-skill-zip-{}-{}.zip",
            std::process::id(),
            entries.len(),
        ));
        let file = std::fs::File::create(&path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        for (name, body) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(body).unwrap();
        }
        zw.finish().unwrap();
        path
    }

    #[test]
    fn extract_zip_writes_files_and_skips_slip() {
        let zip_path = make_zip(&[
            ("SKILL.md", b"---\nname: Z\ndescription: d\n---\nbody"),
            ("scripts/run.sh", b"echo hi"),
            ("../escape.sh", b"pwned"),
        ]);
        let dest = std::env::temp_dir()
            .join(format!("hip-skill-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        super::extract_zip(&zip_path, &dest).unwrap();

        assert!(dest.join("SKILL.md").exists());
        assert!(dest.join("scripts").join("run.sh").exists());
        // The zip-slip entry must NOT have escaped the destination.
        assert!(!dest.parent().unwrap().join("escape.sh").exists());

        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_file(&zip_path);
    }

    #[test]
    fn find_skill_root_finds_nested_skill_md() {
        let dest = std::env::temp_dir()
            .join(format!("hip-skill-root-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        // Many archives wrap content in a top folder; find_skill_root unwraps it.
        let inner = dest.join("my-skill");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(inner.join("SKILL.md"), "---\nname: X\n---\n").unwrap();

        let found = super::find_skill_root(&dest).unwrap();
        assert_eq!(found, inner);

        // Top-level SKILL.md is found directly.
        let dest2 = std::env::temp_dir()
            .join(format!("hip-skill-root2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest2);
        std::fs::create_dir_all(&dest2).unwrap();
        std::fs::write(dest2.join("SKILL.md"), "---\nname: X\n---\n").unwrap();
        assert_eq!(super::find_skill_root(&dest2).unwrap(), dest2);

        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_dir_all(&dest2);
    }

    #[test]
    fn scan_plugin_skills_reads_manifest_and_tags_plugin_id() {
        let root = unique_dir("plugin-skills");
        let _ = std::fs::remove_dir_all(&root);
        let plugin_dir = root.join("sample-plugin");
        std::fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();
        std::fs::create_dir_all(plugin_dir.join("skills").join("sample-greet")).unwrap();
        std::fs::write(
            plugin_dir.join("skills").join("sample-greet").join("SKILL.md"),
            "---\nname: Sample Greet\ndescription: Greets\n---\nbody",
        )
        .unwrap();
        std::fs::write(
            plugin_dir.join(".plugin").join("plugin.json"),
            r#"{"name": "Sample Plugin", "version": "1.0.0", "skills": ["skills/sample-greet"]}"#,
        )
        .unwrap();

        let metas = super::scan_plugin_skills(&root);
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].id, "sample-greet");
        assert_eq!(metas[0].name, "Sample Greet");
        assert_eq!(metas[0].scope, "plugin");
        assert_eq!(metas[0].plugin_id.as_deref(), Some("sample-plugin"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_plugin_skill_dir_resolves_by_skill_id() {
        let root = unique_dir("plugin-skill-find");
        let _ = std::fs::remove_dir_all(&root);
        let plugin_dir = root.join("sample-plugin");
        let skill_dir = plugin_dir.join("skills").join("sample-format");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Sample Format\n---\nbody",
        )
        .unwrap();
        std::fs::write(
            plugin_dir.join(".plugin").join("plugin.json"),
            r#"{"name": "Sample Plugin", "version": "1.0.0", "skills": ["skills/sample-format"]}"#,
        )
        .unwrap();

        let found = super::find_plugin_skill_dir(&root, "sample-format").unwrap();
        assert_eq!(found, skill_dir);
        assert!(super::find_plugin_skill_dir(&root, "missing").is_none());

        let _ = std::fs::remove_dir_all(&root);
    }
}
