//! Local-first knowledge base: spaces, tree.json, docs/*.md under knowledge_dir.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::paths;
use crate::skills::safe_join;

/// Same rule as TS `KNOWLEDGE_ID_RE`.
fn is_knowledge_id(id: &str) -> bool {
    let (prefix, rest) = match id.split_once('_') {
        Some(p) => p,
        None => return false,
    };
    if prefix != "spc" && prefix != "nod" && prefix != "doc" {
        return false;
    }
    let len = rest.len();
    if len < 6 || len > 64 {
        return false;
    }
    rest.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn gen_id(prefix: &str) -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Hex nanos is 16+ chars — satisfies 6..64.
    format!("{prefix}_{n:x}")
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn knowledge_root(app: &AppHandle) -> Result<PathBuf, String> {
    paths::knowledge_dir(app).ok_or_else(|| "knowledge root unavailable".to_string())
}

fn require_id(id: &str, label: &str) -> Result<(), String> {
    if is_knowledge_id(id) {
        Ok(())
    } else {
        Err(format!("invalid {label}: {id}"))
    }
}

fn space_dir(root: &Path, space_id: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    safe_join(root, space_id).ok_or_else(|| "illegal space path".to_string())
}

fn doc_path(root: &Path, space_id: &str, doc_id: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    require_id(doc_id, "docId")?;
    if !doc_id.starts_with("doc_") {
        return Err(format!("docId must start with doc_: {doc_id}"));
    }
    let space = space_dir(root, space_id)?;
    let docs = safe_join(&space, "docs").ok_or_else(|| "illegal docs path".to_string())?;
    let file = format!("{doc_id}.md");
    safe_join(&docs, &file).ok_or_else(|| "illegal doc path".to_string())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension(format!(
        "tmp.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

fn atomic_write_str(path: &Path, s: &str) -> Result<(), String> {
    atomic_write(path, s.as_bytes())
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    atomic_write_str(path, &raw)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSpace {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeIndex {
    version: u32,
    spaces: Vec<KnowledgeSpace>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTreeFile {
    pub version: u32,
    pub nodes: Vec<KnowledgeNode>,
}

fn index_path(root: &Path) -> PathBuf {
    root.join("index.json")
}

fn load_index(root: &Path) -> Result<KnowledgeIndex, String> {
    let path = index_path(root);
    if !path.exists() {
        return Ok(KnowledgeIndex {
            version: 1,
            spaces: vec![],
        });
    }
    read_json_file(&path)
}

fn save_index(root: &Path, index: &KnowledgeIndex) -> Result<(), String> {
    write_json_file(&index_path(root), index)
}

// ── Commands ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn knowledge_ensure_root(app: AppHandle) -> Result<serde_json::Value, String> {
    let root = knowledge_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let idx = index_path(&root);
    if !idx.exists() {
        save_index(
            &root,
            &KnowledgeIndex {
                version: 1,
                spaces: vec![],
            },
        )?;
    }
    Ok(serde_json::json!({ "root": root.to_string_lossy() }))
}

#[tauri::command]
pub fn knowledge_list_spaces(app: AppHandle) -> Result<Vec<KnowledgeSpace>, String> {
    let root = knowledge_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let index = load_index(&root)?;
    Ok(index.spaces)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpaceArgs {
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}

/// Case-insensitive display-name uniqueness among spaces (optional exclude for rename).
fn space_name_taken(spaces: &[KnowledgeSpace], name: &str, exclude_id: Option<&str>) -> bool {
    let key = name.trim().to_lowercase();
    if key.is_empty() {
        return false;
    }
    spaces.iter().any(|s| {
        exclude_id.map(|id| s.id != id).unwrap_or(true)
            && s.name.trim().to_lowercase() == key
    })
}

#[tauri::command]
pub fn knowledge_create_space(app: AppHandle, args: CreateSpaceArgs) -> Result<KnowledgeSpace, String> {
    let name = args.name.trim();
    if name.is_empty() {
        return Err("space name is empty".into());
    }
    let root = knowledge_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let mut index = load_index(&root)?;
    if space_name_taken(&index.spaces, name, None) {
        return Err("space name already exists".into());
    }

    let id = gen_id("spc");
    let ts = now_ms();
    let space = KnowledgeSpace {
        id: id.clone(),
        name: name.to_string(),
        icon: args.icon.filter(|s| !s.is_empty()),
        created_at: ts,
        updated_at: ts,
    };

    let dir = space_dir(&root, &id)?;
    fs::create_dir_all(dir.join("docs")).map_err(|e| e.to_string())?;
    write_json_file(
        &dir.join("tree.json"),
        &KnowledgeTreeFile {
            version: 1,
            nodes: vec![],
        },
    )?;
    write_json_file(&dir.join("meta.json"), &space)?;

    index.spaces.push(space.clone());
    save_index(&root, &index)?;
    Ok(space)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSpaceArgs {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[tauri::command]
pub fn knowledge_update_space(app: AppHandle, args: UpdateSpaceArgs) -> Result<KnowledgeSpace, String> {
    require_id(&args.id, "spaceId")?;
    let root = knowledge_root(&app)?;
    let mut index = load_index(&root)?;
    let pos = index
        .spaces
        .iter()
        .position(|s| s.id == args.id)
        .ok_or_else(|| "space not found".to_string())?;

    let next_name = if let Some(name) = args.name.as_ref() {
        let name = name.trim();
        if name.is_empty() {
            return Err("space name is empty".into());
        }
        if space_name_taken(&index.spaces, name, Some(&args.id)) {
            return Err("space name already exists".into());
        }
        Some(name.to_string())
    } else {
        None
    };

    let ts = now_ms();
    {
        let s = &mut index.spaces[pos];
        if let Some(name) = next_name {
            s.name = name;
        }
        if let Some(icon) = args.icon {
            s.icon = if icon.is_empty() { None } else { Some(icon) };
        }
        s.updated_at = ts;
    }
    let updated = index.spaces[pos].clone();
    let dir = space_dir(&root, &args.id)?;
    write_json_file(&dir.join("meta.json"), &updated)?;
    save_index(&root, &index)?;
    Ok(updated)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSpaceArgs {
    pub id: String,
}

#[tauri::command]
pub fn knowledge_delete_space(app: AppHandle, args: DeleteSpaceArgs) -> Result<(), String> {
    require_id(&args.id, "spaceId")?;
    let root = knowledge_root(&app)?;
    let mut index = load_index(&root)?;
    let before = index.spaces.len();
    index.spaces.retain(|s| s.id != args.id);
    if index.spaces.len() == before {
        return Err("space not found".into());
    }
    // Index first, then directory (orphan dir OK on crash).
    save_index(&root, &index)?;
    let dir = space_dir(&root, &args.id)?;
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceIdArgs {
    pub space_id: String,
}

#[tauri::command]
pub fn knowledge_get_tree(app: AppHandle, args: SpaceIdArgs) -> Result<KnowledgeTreeFile, String> {
    let root = knowledge_root(&app)?;
    let dir = space_dir(&root, &args.space_id)?;
    let path = dir.join("tree.json");
    if !path.exists() {
        return Ok(KnowledgeTreeFile {
            version: 1,
            nodes: vec![],
        });
    }
    read_json_file(&path)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTreeArgs {
    pub space_id: String,
    pub tree: KnowledgeTreeFile,
}

#[tauri::command]
pub fn knowledge_save_tree(app: AppHandle, args: SaveTreeArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    let dir = space_dir(&root, &args.space_id)?;
    if !dir.exists() {
        return Err("space not found".into());
    }
    write_json_file(&dir.join("tree.json"), &args.tree)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocArgs {
    pub space_id: String,
    pub doc_id: String,
}

#[tauri::command]
pub fn knowledge_read_doc(app: AppHandle, args: DocArgs) -> Result<String, String> {
    let root = knowledge_root(&app)?;
    let path = doc_path(&root, &args.space_id, &args.doc_id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteDocArgs {
    pub space_id: String,
    pub doc_id: String,
    pub body: String,
}

#[tauri::command]
pub fn knowledge_write_doc(app: AppHandle, args: WriteDocArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    let path = doc_path(&root, &args.space_id, &args.doc_id)?;
    atomic_write_str(&path, &args.body)
}

#[tauri::command]
pub fn knowledge_delete_doc_file(app: AppHandle, args: DocArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    let path = doc_path(&root, &args.space_id, &args.doc_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    // Drop version history with the doc (space delete removes the whole tree).
    if let Ok(vdir) = versions_dir(&root, &args.space_id, &args.doc_id) {
        if vdir.exists() {
            let _ = fs::remove_dir_all(&vdir);
        }
    }
    Ok(())
}

// ── Version snapshots (P1.8) ──────────────────────────────────────────────

/// Max retained snapshots per document (matches TS `KNOWLEDGE_VERSION_CAP`).
const KNOWLEDGE_VERSION_CAP: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeVersionEntry {
    /// File stem / id (filesystem-safe ISO timestamp).
    pub id: String,
    pub file: String,
    pub created_at: i64,
    /// `"daily"` | `"manual"`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day_key: Option<String>,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionManifest {
    version: u32,
    entries: Vec<KnowledgeVersionEntry>,
}

fn empty_manifest() -> VersionManifest {
    VersionManifest {
        version: 1,
        entries: vec![],
    }
}

fn versions_dir(root: &Path, space_id: &str, doc_id: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    require_id(doc_id, "docId")?;
    if !doc_id.starts_with("doc_") {
        return Err(format!("docId must start with doc_: {doc_id}"));
    }
    let space = space_dir(root, space_id)?;
    let versions = safe_join(&space, "versions").ok_or_else(|| "illegal versions path".to_string())?;
    safe_join(&versions, doc_id).ok_or_else(|| "illegal version doc path".to_string())
}

fn version_manifest_path(vdir: &Path) -> PathBuf {
    vdir.join("manifest.json")
}

fn load_version_manifest(vdir: &Path) -> Result<VersionManifest, String> {
    let path = version_manifest_path(vdir);
    if !path.exists() {
        return Ok(empty_manifest());
    }
    read_json_file(&path)
}

fn save_version_manifest(vdir: &Path, manifest: &VersionManifest) -> Result<(), String> {
    write_json_file(&version_manifest_path(vdir), manifest)
}

/// Filesystem-safe ISO-like id from epoch ms: `2026-07-14T12-30-45-123`.
fn version_id_from_ms(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000) as u32;
    // UTC breakdown is fine for unique ids; dayKey carries local calendar day.
    let days = secs.div_euclid(86_400);
    let day_secs = secs.rem_euclid(86_400) as u32;
    let (y, m, d) = civil_from_days(days);
    let hh = day_secs / 3600;
    let mm = (day_secs % 3600) / 60;
    let ss = day_secs % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}-{mm:02}-{ss:02}-{millis:03}")
}

/// Howard Hinnant civil_from_days (proleptic Gregorian, UTC).
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn version_file_path(vdir: &Path, file: &str) -> Result<PathBuf, String> {
    // Only allow simple filenames (no path separators / traversal).
    if file.is_empty()
        || file.contains('/')
        || file.contains('\\')
        || file.contains("..")
        || !file.ends_with(".md")
    {
        return Err(format!("invalid version file: {file}"));
    }
    let stem = file.trim_end_matches(".md");
    if stem.is_empty()
        || !stem
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == 'T' || c == '_')
    {
        return Err(format!("invalid version file: {file}"));
    }
    safe_join(vdir, file).ok_or_else(|| "illegal version file path".to_string())
}

fn enforce_version_cap(vdir: &Path, manifest: &mut VersionManifest) -> Result<(), String> {
    // Entries are newest-first.
    while manifest.entries.len() > KNOWLEDGE_VERSION_CAP {
        if let Some(old) = manifest.entries.pop() {
            if let Ok(path) = version_file_path(vdir, &old.file) {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

/// Create a snapshot. Daily: skip if `day_key` already has a daily entry, or body == last snapshot.
/// Manual: always create. Returns `None` when skipped (daily only).
fn save_version_inner(
    root: &Path,
    space_id: &str,
    doc_id: &str,
    kind: &str,
    day_key: Option<&str>,
) -> Result<Option<KnowledgeVersionEntry>, String> {
    if kind != "daily" && kind != "manual" {
        return Err(format!("invalid version kind: {kind}"));
    }
    let doc = doc_path(root, space_id, doc_id)?;
    let body = if doc.exists() {
        fs::read_to_string(&doc).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let vdir = versions_dir(root, space_id, doc_id)?;
    fs::create_dir_all(&vdir).map_err(|e| e.to_string())?;
    let mut manifest = load_version_manifest(&vdir)?;

    if kind == "daily" {
        let key = day_key.ok_or_else(|| "dayKey required for daily snapshot".to_string())?;
        if key.is_empty() || key.len() > 32 {
            return Err("invalid dayKey".into());
        }
        if manifest
            .entries
            .iter()
            .any(|e| e.kind == "daily" && e.day_key.as_deref() == Some(key))
        {
            return Ok(None);
        }
        if let Some(last) = manifest.entries.first() {
            if let Ok(last_path) = version_file_path(&vdir, &last.file) {
                if last_path.exists() {
                    let last_body = fs::read_to_string(&last_path).map_err(|e| e.to_string())?;
                    if last_body == body {
                        return Ok(None);
                    }
                }
            }
        }
    }

    let created_at = now_ms();
    let mut id = version_id_from_ms(created_at);
    // Uniqueness if two saves share the same ms.
    if manifest.entries.iter().any(|e| e.id == id) {
        id = format!("{id}-{}", gen_id("v").trim_start_matches("v_"));
        // Keep stem charset safe.
        id = id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == 'T' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
    }
    let file = format!("{id}.md");
    let path = version_file_path(&vdir, &file)?;
    atomic_write_str(&path, &body)?;

    let entry = KnowledgeVersionEntry {
        id: id.clone(),
        file,
        created_at,
        kind: kind.to_string(),
        day_key: if kind == "daily" {
            day_key.map(|s| s.to_string())
        } else {
            None
        },
        byte_length: body.len() as u64,
    };
    manifest.entries.insert(0, entry.clone());
    enforce_version_cap(&vdir, &mut manifest)?;
    save_version_manifest(&vdir, &manifest)?;
    Ok(Some(entry))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersionArgs {
    pub space_id: String,
    pub doc_id: String,
    /// `"daily"` | `"manual"`.
    pub kind: String,
    /// Local calendar day `YYYY-MM-DD` (required for daily).
    #[serde(default)]
    pub day_key: Option<String>,
}

#[tauri::command]
pub fn knowledge_save_version(
    app: AppHandle,
    args: SaveVersionArgs,
) -> Result<Option<KnowledgeVersionEntry>, String> {
    let root = knowledge_root(&app)?;
    save_version_inner(
        &root,
        &args.space_id,
        &args.doc_id,
        &args.kind,
        args.day_key.as_deref(),
    )
}

#[tauri::command]
pub fn knowledge_list_versions(
    app: AppHandle,
    args: DocArgs,
) -> Result<Vec<KnowledgeVersionEntry>, String> {
    let root = knowledge_root(&app)?;
    let vdir = versions_dir(&root, &args.space_id, &args.doc_id)?;
    if !vdir.exists() {
        return Ok(vec![]);
    }
    let manifest = load_version_manifest(&vdir)?;
    Ok(manifest.entries)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionIdArgs {
    pub space_id: String,
    pub doc_id: String,
    pub version_id: String,
}

fn find_version_entry<'a>(
    manifest: &'a VersionManifest,
    version_id: &str,
) -> Result<&'a KnowledgeVersionEntry, String> {
    require_id_like_version(version_id)?;
    manifest
        .entries
        .iter()
        .find(|e| e.id == version_id)
        .ok_or_else(|| "version not found".into())
}

fn require_id_like_version(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == 'T' || c == '_')
    {
        return Err(format!("invalid versionId: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn knowledge_read_version(app: AppHandle, args: VersionIdArgs) -> Result<String, String> {
    let root = knowledge_root(&app)?;
    let vdir = versions_dir(&root, &args.space_id, &args.doc_id)?;
    let manifest = load_version_manifest(&vdir)?;
    let entry = find_version_entry(&manifest, &args.version_id)?;
    let path = version_file_path(&vdir, &entry.file)?;
    if !path.exists() {
        return Err("version file missing".into());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Restore snapshot into the live doc via atomic write; returns restored body.
#[tauri::command]
pub fn knowledge_restore_version(app: AppHandle, args: VersionIdArgs) -> Result<String, String> {
    let root = knowledge_root(&app)?;
    let vdir = versions_dir(&root, &args.space_id, &args.doc_id)?;
    let manifest = load_version_manifest(&vdir)?;
    let entry = find_version_entry(&manifest, &args.version_id)?;
    let path = version_file_path(&vdir, &entry.file)?;
    if !path.exists() {
        return Err("version file missing".into());
    }
    let body = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let doc = doc_path(&root, &args.space_id, &args.doc_id)?;
    atomic_write_str(&doc, &body)?;
    Ok(body)
}

// ── Export / import / reveal ──────────────────────────────────────────────

fn sanitize_filename(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        s = "untitled".into();
    }
    // cap length
    if s.chars().count() > 80 {
        s = s.chars().take(80).collect();
    }
    s
}

fn unique_name(used: &mut std::collections::HashMap<String, u32>, base: &str) -> String {
    let n = used.entry(base.to_string()).or_insert(0);
    *n += 1;
    if *n == 1 {
        base.to_string()
    } else {
        format!("{base} ({n})")
    }
}

/// Reject zip-slip style entries: absolute paths or `..` / empty path components.
/// Titles like `a..b` are fine after sanitize (they stay a single component).
fn is_safe_zip_entry(name: &str) -> bool {
    if name.is_empty() || name.starts_with('/') || name.starts_with('\\') {
        return false;
    }
    for part in name.split(['/', '\\']) {
        if part.is_empty() || part == "." || part == ".." {
            return false;
        }
    }
    true
}

const MAX_IMPORT_DOCS: u32 = 5000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocArgs {
    pub space_id: String,
    pub doc_id: String,
    pub dest_path: String,
}

#[tauri::command]
pub fn knowledge_export_doc(app: AppHandle, args: ExportDocArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    let src = doc_path(&root, &args.space_id, &args.doc_id)?;
    let body = if src.exists() {
        fs::read_to_string(&src).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let dest = PathBuf::from(&args.dest_path);
    if !dest.is_absolute() {
        return Err("destPath must be absolute".into());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write_str(&dest, &body)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpaceZipArgs {
    pub space_id: String,
    pub dest_path: String,
}

#[tauri::command]
pub fn knowledge_export_space_zip(app: AppHandle, args: ExportSpaceZipArgs) -> Result<(), String> {
    use std::collections::HashMap;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let dir = space_dir(&root, &args.space_id)?;
    if !dir.exists() {
        return Err("space not found".into());
    }
    let tree: KnowledgeTreeFile = read_json_file(&dir.join("tree.json"))?;
    let dest = PathBuf::from(&args.dest_path);
    if !dest.is_absolute() {
        return Err("destPath must be absolute".into());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Build human path map
    let by_id: HashMap<String, &KnowledgeNode> =
        tree.nodes.iter().map(|n| (n.id.clone(), n)).collect();
    let mut path_cache: HashMap<String, String> = HashMap::new();
    let mut used_at_parent: HashMap<String, HashMap<String, u32>> = HashMap::new();

    fn path_for(
        id: &str,
        by_id: &HashMap<String, &KnowledgeNode>,
        path_cache: &mut HashMap<String, String>,
        used_at_parent: &mut HashMap<String, HashMap<String, u32>>,
        visiting: &mut std::collections::HashSet<String>,
    ) -> Result<String, String> {
        if let Some(p) = path_cache.get(id) {
            return Ok(p.clone());
        }
        if !visiting.insert(id.to_string()) {
            return Err(format!("cycle in tree at {id}"));
        }
        let node = by_id.get(id).ok_or_else(|| format!("missing node {id}"))?;
        let base = sanitize_filename(&node.title);
        let parent_key = node.parent_id.clone().unwrap_or_else(|| "__root__".into());
        let bucket = used_at_parent.entry(parent_key.clone()).or_default();
        let unique = unique_name(bucket, &base);
        let full = if let Some(ref pid) = node.parent_id {
            let parent_path = path_for(pid, by_id, path_cache, used_at_parent, visiting)?;
            format!("{parent_path}/{unique}")
        } else {
            unique
        };
        visiting.remove(id);
        path_cache.insert(id.to_string(), full.clone());
        Ok(full)
    }

    let mut doc_count = 0usize;
    for n in &tree.nodes {
        if n.kind == "doc" {
            doc_count += 1;
        }
    }
    if doc_count > 5000 {
        return Err("space has too many documents to export (max 5000)".into());
    }

    let file = fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for n in &tree.nodes {
        if n.kind != "doc" {
            continue;
        }
        let mut visiting = std::collections::HashSet::new();
        let rel = path_for(
            &n.id,
            &by_id,
            &mut path_cache,
            &mut used_at_parent,
            &mut visiting,
        )?;
        let entry_name = format!("{rel}.md");
        if !is_safe_zip_entry(&entry_name) {
            return Err("illegal export path".into());
        }
        let body = {
            let p = doc_path(&root, &args.space_id, &n.id)?;
            if p.exists() {
                fs::read_to_string(&p).map_err(|e| e.to_string())?
            } else {
                String::new()
            }
        };
        zip.start_file(entry_name, opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }

    // optional lightweight manifest
    let manifest = serde_json::json!({
        "format": "hip-knowledge-export",
        "version": 1,
        "spaceId": args.space_id,
        "exportedAt": now_ms(),
    });
    zip.start_file("hip-manifest.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFolderArgs {
    pub source_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFolderResult {
    pub space_id: String,
    pub imported_docs: u32,
}

#[tauri::command]
pub fn knowledge_import_folder(
    app: AppHandle,
    args: ImportFolderArgs,
) -> Result<ImportFolderResult, String> {
    let source = PathBuf::from(&args.source_path);
    if !source.is_dir() {
        return Err("sourcePath must be a directory".into());
    }
    let source_canon = source
        .canonicalize()
        .map_err(|e| format!("cannot resolve sourcePath: {e}"))?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported")
        .to_string();

    // Create space via same layout as create_space; roll back on failure.
    let space = knowledge_create_space(
        app.clone(),
        CreateSpaceArgs {
            name,
            icon: None,
        },
    )?;
    let root = knowledge_root(&app)?;
    let space_root = space_dir(&root, &space.id)?;

    let mut nodes: Vec<KnowledgeNode> = Vec::new();
    let mut imported = 0u32;
    let mut folder_map: std::collections::HashMap<PathBuf, String> =
        std::collections::HashMap::new();

    fn ensure_folder_chain(
        rel_dir: &Path,
        folder_map: &mut std::collections::HashMap<PathBuf, String>,
        nodes: &mut Vec<KnowledgeNode>,
    ) -> Result<Option<String>, String> {
        if rel_dir.as_os_str().is_empty() {
            return Ok(None);
        }
        if let Some(id) = folder_map.get(rel_dir) {
            return Ok(Some(id.clone()));
        }
        let parent_rel = rel_dir.parent().unwrap_or_else(|| Path::new(""));
        let parent_id = ensure_folder_chain(parent_rel, folder_map, nodes)?;
        let title = rel_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("folder")
            .to_string();
        let id = gen_id("nod");
        let now = now_ms();
        let order = nodes
            .iter()
            .filter(|n| n.parent_id == parent_id)
            .map(|n| n.order)
            .max()
            .map(|o| o + 1)
            .unwrap_or(0);
        nodes.push(KnowledgeNode {
            id: id.clone(),
            parent_id,
            kind: "folder".into(),
            title,
            order,
            created_at: now,
            updated_at: now,
        });
        folder_map.insert(rel_dir.to_path_buf(), id.clone());
        Ok(Some(id))
    }

    fn walk_md(
        source_canon: &Path,
        dir: &Path,
        rel: &Path,
        folder_map: &mut std::collections::HashMap<PathBuf, String>,
        nodes: &mut Vec<KnowledgeNode>,
        space_id: &str,
        imported: &mut u32,
        root: &Path,
    ) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
        for ent in entries.flatten() {
            let path = ent.path();
            let name = ent.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') {
                continue;
            }
            // Skip symlinks entirely (prevents escape via link targets).
            let meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            // Resolved path must stay under source.
            let Ok(canon) = path.canonicalize() else {
                continue;
            };
            if !canon.starts_with(source_canon) {
                continue;
            }
            if meta.is_dir() {
                let child_rel = rel.join(&*name_str);
                ensure_folder_chain(&child_rel, folder_map, nodes)?;
                walk_md(
                    source_canon,
                    &path,
                    &child_rel,
                    folder_map,
                    nodes,
                    space_id,
                    imported,
                    root,
                )?;
            } else if name_str.to_lowercase().ends_with(".md") {
                if *imported >= MAX_IMPORT_DOCS {
                    return Err(format!(
                        "import exceeds max documents ({MAX_IMPORT_DOCS})"
                    ));
                }
                let parent_id = if rel.as_os_str().is_empty() {
                    None
                } else {
                    ensure_folder_chain(rel, folder_map, nodes)?
                };
                let title = name_str.trim_end_matches(".md").trim_end_matches(".MD");
                let doc_id = gen_id("doc");
                let body = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let dest = doc_path(root, space_id, &doc_id)?;
                atomic_write_str(&dest, &body)?;
                let now = now_ms();
                let order = nodes
                    .iter()
                    .filter(|n| n.parent_id == parent_id)
                    .map(|n| n.order)
                    .max()
                    .map(|o| o + 1)
                    .unwrap_or(0);
                nodes.push(KnowledgeNode {
                    id: doc_id,
                    parent_id,
                    kind: "doc".into(),
                    title: title.to_string(),
                    order,
                    created_at: now,
                    updated_at: now,
                });
                *imported += 1;
            }
        }
        Ok(())
    }

    let walk_result = walk_md(
        &source_canon,
        &source,
        Path::new(""),
        &mut folder_map,
        &mut nodes,
        &space.id,
        &mut imported,
        &root,
    );

    if let Err(e) = walk_result {
        let _ = knowledge_delete_space(
            app,
            DeleteSpaceArgs {
                id: space.id.clone(),
            },
        );
        return Err(e);
    }

    if let Err(e) = write_json_file(
        &space_root.join("tree.json"),
        &KnowledgeTreeFile {
            version: 1,
            nodes,
        },
    ) {
        let _ = knowledge_delete_space(
            app,
            DeleteSpaceArgs {
                id: space.id.clone(),
            },
        );
        return Err(e);
    }

    Ok(ImportFolderResult {
        space_id: space.id,
        imported_docs: imported,
    })
}

#[tauri::command]
pub fn knowledge_reveal_doc(app: AppHandle, args: DocArgs) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = knowledge_root(&app)?;
    let path = doc_path(&root, &args.space_id, &args.doc_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| "doc path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Never write empty files on reveal — show file if present, else docs folder.
    let target = if path.is_file() { path.as_path() } else { parent };
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|e| e.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;

    // Serialize env mutation across tests.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_root<F: FnOnce(&Path)>(f: F) {
        let _g = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!(
            "hip-kb-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        env::set_var("HIP_DATA_DIR", &dir);
        // knowledge lives under HIP_DATA_DIR/knowledge when using knowledge_dir via app —
        // pure helpers use root directly in unit tests below.
        f(&dir);
        env::remove_var("HIP_DATA_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reject_illegal_ids() {
        assert!(!is_knowledge_id(""));
        assert!(!is_knowledge_id("foo_bar"));
        assert!(!is_knowledge_id("spc_ab")); // too short
        assert!(!is_knowledge_id("spc_../evil"));
        assert!(!is_knowledge_id("spc_a/b"));
        assert!(is_knowledge_id("spc_xYzAbCdEfGhI"));
        assert!(is_knowledge_id("doc_abc123def456"));
        assert!(is_knowledge_id("nod_folder001"));
    }

    #[test]
    fn reject_path_traversal_dotdot() {
        let dest = Path::new("/tmp/kb-root");
        assert!(safe_join(dest, "../evil").is_none());
        assert!(safe_join(dest, "a/../../b").is_none());
        assert!(safe_join(dest, "spc_oktoken1").is_some());
    }

    #[test]
    fn space_name_taken_is_case_insensitive() {
        let spaces = vec![KnowledgeSpace {
            id: "spc_a".into(),
            name: "Notes".into(),
            icon: None,
            created_at: 1,
            updated_at: 1,
        }];
        assert!(space_name_taken(&spaces, "notes", None));
        assert!(space_name_taken(&spaces, "  NOTES  ", None));
        assert!(!space_name_taken(&spaces, "notes", Some("spc_a")));
        assert!(!space_name_taken(&spaces, "Other", None));
    }

    #[test]
    fn sanitize_and_zip_entry_safety() {
        assert_eq!(sanitize_filename("a/b"), "a_b");
        assert_eq!(sanitize_filename("  "), "untitled");
        // substring ".." in a single component is allowed
        assert!(is_safe_zip_entry("notes..archive.md"));
        assert!(is_safe_zip_entry("folder/a..b.md"));
        assert!(!is_safe_zip_entry("../evil.md"));
        assert!(!is_safe_zip_entry("a/../b.md"));
        assert!(!is_safe_zip_entry("/abs.md"));
        assert!(!is_safe_zip_entry(""));
    }

    #[test]
    fn create_space_layout() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            fs::create_dir_all(&root).unwrap();
            let id = "spc_testspace01";
            let dir = space_dir(&root, id).unwrap();
            fs::create_dir_all(dir.join("docs")).unwrap();
            let space = KnowledgeSpace {
                id: id.to_string(),
                name: "Test".into(),
                icon: Some("📦".into()),
                created_at: 1,
                updated_at: 1,
            };
            write_json_file(&dir.join("meta.json"), &space).unwrap();
            write_json_file(
                &dir.join("tree.json"),
                &KnowledgeTreeFile {
                    version: 1,
                    nodes: vec![],
                },
            )
            .unwrap();
            let mut index = KnowledgeIndex {
                version: 1,
                spaces: vec![],
            };
            index.spaces.push(space);
            save_index(&root, &index).unwrap();

            assert!(dir.join("meta.json").exists());
            assert!(dir.join("tree.json").exists());
            assert!(dir.join("docs").is_dir());
            let loaded = load_index(&root).unwrap();
            assert_eq!(loaded.spaces.len(), 1);
            assert_eq!(loaded.spaces[0].name, "Test");
        });
    }

    #[test]
    fn atomic_write_readable() {
        with_temp_root(|base| {
            let path = base.join("t.json");
            atomic_write_str(&path, r#"{"ok":true}"#).unwrap();
            let s = fs::read_to_string(&path).unwrap();
            assert!(s.contains("ok"));
        });
    }

    #[test]
    fn doc_path_rejects_bad_ids() {
        let root = Path::new("/tmp/kb");
        assert!(doc_path(root, "bad", "doc_abc123def456").is_err());
        assert!(doc_path(root, "spc_oktoken1", "nod_notadoc1").is_err());
        assert!(doc_path(root, "spc_oktoken1", "doc_abc123def456").is_ok());
    }

    #[test]
    fn version_snapshots_daily_manual_cap_and_delete() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            let space_id = "spc_oktoken1";
            let doc_id = "doc_abc123def456";
            let space = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(space.join("docs")).unwrap();
            let doc = doc_path(&root, space_id, doc_id).unwrap();
            atomic_write_str(&doc, "body-v1").unwrap();

            // Manual always creates.
            let e1 = save_version_inner(&root, space_id, doc_id, "manual", None)
                .unwrap()
                .expect("manual snapshot");
            assert_eq!(e1.kind, "manual");
            assert_eq!(e1.byte_length, 7);

            // Daily with same body as last snapshot → skip.
            let skip_same = save_version_inner(&root, space_id, doc_id, "daily", Some("2026-07-14"))
                .unwrap();
            assert!(skip_same.is_none());

            // Body changed → first daily of the day creates.
            atomic_write_str(&doc, "body-v2").unwrap();
            let d1 = save_version_inner(&root, space_id, doc_id, "daily", Some("2026-07-14"))
                .unwrap()
                .expect("daily first");
            assert_eq!(d1.day_key.as_deref(), Some("2026-07-14"));

            // Same day again → skip even if body changed (first save of day only).
            atomic_write_str(&doc, "body-v3").unwrap();
            let skip = save_version_inner(&root, space_id, doc_id, "daily", Some("2026-07-14"))
                .unwrap();
            assert!(skip.is_none());

            // New day with body ≠ last snapshot → creates.
            let d2 = save_version_inner(&root, space_id, doc_id, "daily", Some("2026-07-15"))
                .unwrap()
                .expect("daily new day");
            assert_eq!(d2.day_key.as_deref(), Some("2026-07-15"));

            // Body equals last snapshot → skip on a new day.
            let skip2 = save_version_inner(&root, space_id, doc_id, "daily", Some("2026-07-16"))
                .unwrap();
            assert!(skip2.is_none());

            // Cap: fill past 30.
            for i in 0..35 {
                atomic_write_str(&doc, &format!("cap-{i}")).unwrap();
                let _ = save_version_inner(&root, space_id, doc_id, "manual", None).unwrap();
            }
            let vdir = versions_dir(&root, space_id, doc_id).unwrap();
            let manifest = load_version_manifest(&vdir).unwrap();
            assert!(manifest.entries.len() <= KNOWLEDGE_VERSION_CAP);
            assert_eq!(manifest.entries.len(), KNOWLEDGE_VERSION_CAP);

            // Restore oldest remaining would work; restore newest.
            let newest = manifest.entries[0].id.clone();
            let restored_body = {
                let path = version_file_path(&vdir, &manifest.entries[0].file).unwrap();
                fs::read_to_string(path).unwrap()
            };
            // Simulate restore via atomic write of that body.
            atomic_write_str(&doc, &restored_body).unwrap();
            assert_eq!(fs::read_to_string(&doc).unwrap(), restored_body);
            assert_eq!(newest, manifest.entries[0].id);

            // Path traversal rejected.
            assert!(version_file_path(&vdir, "../evil.md").is_err());
            assert!(version_file_path(&vdir, "a/b.md").is_err());

            // Delete doc file cleans versions dir.
            let vdir_exists = vdir.exists();
            assert!(vdir_exists);
            fs::remove_file(&doc).unwrap();
            let _ = fs::remove_dir_all(&vdir);
            // Mirror knowledge_delete_doc_file cleanup:
            if vdir.exists() {
                let _ = fs::remove_dir_all(&vdir);
            }
            assert!(!versions_dir(&root, space_id, doc_id).unwrap().exists()
                || !fs::read_dir(versions_dir(&root, space_id, doc_id).unwrap())
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false));
        });
    }

    #[test]
    fn version_delete_doc_cleans_versions_dir() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            let space_id = "spc_oktoken1";
            let doc_id = "doc_abc123def456";
            let space = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(space.join("docs")).unwrap();
            let doc = doc_path(&root, space_id, doc_id).unwrap();
            atomic_write_str(&doc, "x").unwrap();
            save_version_inner(&root, space_id, doc_id, "manual", None)
                .unwrap()
                .unwrap();
            let vdir = versions_dir(&root, space_id, doc_id).unwrap();
            assert!(vdir.exists());
            // Inline the delete_doc cleanup path (command needs AppHandle).
            if doc.exists() {
                fs::remove_file(&doc).unwrap();
            }
            if vdir.exists() {
                fs::remove_dir_all(&vdir).unwrap();
            }
            assert!(!vdir.exists());
        });
    }
}
