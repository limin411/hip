//! Local-first knowledge base: spaces, tree.json, docs/*.md under knowledge_dir.
//! Assets live under `<space>/assets/` (space-root-relative MD links).

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::paths;
use crate::skills::safe_join;

/// Max asset size on disk (path import / file picker).
const KNOWLEDGE_ASSET_MAX_BYTES: u64 = 25 * 1024 * 1024;
/// Max raw bytes for base64 IPC (`read_asset_data`, `import_asset_bytes`).
const KNOWLEDGE_ASSET_INLINE_MAX_BYTES: u64 = 1_500_000;
/// Max board scene JSON size for `knowledge_write_board` (v1).
const KNOWLEDGE_BOARD_MAX_BYTES: usize = 25 * 1024 * 1024;

/// Empty dehydrated Excalidraw scene returned when board file is missing.
pub(crate) const EMPTY_BOARD_SCENE_JSON: &str = r##"{"type":"excalidraw","version":2,"source":"hip","hip":{"schemaVersion":1},"elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}"##;

/// Same rule as TS `KNOWLEDGE_ID_RE`.
pub(crate) fn is_knowledge_id(id: &str) -> bool {
    let (prefix, rest) = match id.split_once('_') {
        Some(p) => p,
        None => return false,
    };
    if prefix != "spc" && prefix != "nod" && prefix != "doc" && prefix != "brd" {
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

/// `~/.hip/knowledge/<space>/boards/<brd_*.excalidraw>`
pub(crate) fn board_path(root: &Path, space_id: &str, board_id: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    require_id(board_id, "boardId")?;
    if !board_id.starts_with("brd_") {
        return Err(format!("boardId must start with brd_: {board_id}"));
    }
    let space = space_dir(root, space_id)?;
    let boards = safe_join(&space, "boards").ok_or_else(|| "illegal boards path".to_string())?;
    let file = format!("{board_id}.excalidraw");
    safe_join(&boards, &file).ok_or_else(|| "illegal board path".to_string())
}

/// Field-level reject: any `files[*]` object that has a `dataURL` key is illegal.
/// Element text containing the substring `dataURL` is allowed.
pub(crate) fn assert_no_data_url_in_board_json(raw: &str) -> Result<(), String> {
    let scene: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("invalid board JSON: {e}"))?;
    let Some(files) = scene.get("files") else {
        return Ok(());
    };
    let Some(obj) = files.as_object() else {
        return Ok(());
    };
    for (id, f) in obj {
        if let Some(map) = f.as_object() {
            if map.contains_key("dataURL") {
                return Err(format!("board file {id} must not contain dataURL"));
            }
        }
    }
    Ok(())
}

fn validate_board_write_body(body: &str) -> Result<(), String> {
    if body.len() > KNOWLEDGE_BOARD_MAX_BYTES {
        return Err(format!(
            "board body exceeds {} bytes",
            KNOWLEDGE_BOARD_MAX_BYTES
        ));
    }
    assert_no_data_url_in_board_json(body)
}

/// kind ⇔ id prefix (Issue 13). Used by save_tree validation.
fn kind_prefix_ok(kind: &str, id: &str) -> bool {
    match kind {
        "folder" => id.starts_with("nod_"),
        "doc" => id.starts_with("doc_"),
        "board" => id.starts_with("brd_"),
        _ => false,
    }
}

fn validate_tree_nodes(nodes: &[KnowledgeNode]) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    for n in nodes {
        if !is_knowledge_id(&n.id) {
            return Err(format!("invalid node id: {}", n.id));
        }
        if !ids.insert(n.id.clone()) {
            return Err(format!("duplicate node id: {}", n.id));
        }
        if !kind_prefix_ok(&n.kind, &n.id) {
            return Err(format!(
                "kind {} requires matching id prefix for {}",
                n.kind, n.id
            ));
        }
    }
    for n in nodes {
        if let Some(ref pid) = n.parent_id {
            if !ids.contains(pid) {
                return Err(format!("missing parent {pid} for {}", n.id));
            }
        }
    }
    Ok(())
}

/// Resolve a space-root-relative path that must stay under `assets/`.
/// `rel_path` may be `assets/foo.png`, `assets/sub/foo.png`, or bare `foo.png`.
/// Nested directories are allowed; `..` segments are rejected via `safe_join`.
fn asset_path(root: &Path, space_id: &str, rel_path: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    let space = space_dir(root, space_id)?;
    let trimmed = rel_path
        .trim()
        .trim_start_matches("./")
        .replace('\\', "/");
    if trimmed.is_empty() {
        return Err("empty asset path".into());
    }
    let under_assets = if let Some(rest) = trimmed.strip_prefix("assets/") {
        rest
    } else if trimmed == "assets" {
        return Err("asset path must be a file under assets/".into());
    } else if !trimmed.contains('/') {
        trimmed.as_str()
    } else {
        return Err("asset path must be under assets/".into());
    };
    if under_assets.is_empty() {
        return Err("asset path must be a file under assets/".into());
    }
    // Reject empty segments and explicit `.` / `..` even before safe_join.
    for seg in under_assets.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err("illegal asset path segment".into());
        }
    }
    let assets = safe_join(&space, "assets").ok_or_else(|| "illegal assets path".to_string())?;
    // Nested: join each segment so safe_join never sees `..` as a single string issue
    // (safe_join already walks components).
    safe_join(&assets, under_assets).ok_or_else(|| "illegal asset path".to_string())
}

fn allowed_asset_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf"
    )
}

fn mime_from_ext(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

fn ext_for_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "application/pdf" => Some("pdf"),
        _ => None,
    }
}

/// Sanitize a user-facing file name for use after `ast_<id>_`.
fn sanitize_asset_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let mut s: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | ' ' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        s = "file".into();
    }
    if s.chars().count() > 80 {
        s = s.chars().take(80).collect();
    }
    s
}

fn gen_asset_rel_path(file_name: &str) -> String {
    let safe = sanitize_asset_filename(file_name);
    let id = gen_id("ast");
    format!("assets/{id}_{safe}")
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
    // Windows: rename fails when destination exists — remove first (same as atomic_write_private).
    #[cfg(windows)]
    {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e.to_string());
            }
        }
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
    validate_tree_nodes(&args.tree.nodes)?;
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

// ── Board files (Excalidraw dehydrated JSON under boards/) ────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardArgs {
    pub space_id: String,
    pub board_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteBoardArgs {
    pub space_id: String,
    pub board_id: String,
    pub body: String,
}

#[tauri::command]
pub fn knowledge_read_board(app: AppHandle, args: BoardArgs) -> Result<String, String> {
    let root = knowledge_root(&app)?;
    let path = board_path(&root, &args.space_id, &args.board_id)?;
    if !path.exists() {
        return Ok(EMPTY_BOARD_SCENE_JSON.to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn knowledge_write_board(app: AppHandle, args: WriteBoardArgs) -> Result<(), String> {
    validate_board_write_body(&args.body)?;
    let root = knowledge_root(&app)?;
    let path = board_path(&root, &args.space_id, &args.board_id)?;
    atomic_write_str(&path, &args.body)
}

#[tauri::command]
pub fn knowledge_delete_board_file(app: AppHandle, args: BoardArgs) -> Result<(), String> {
    let root = knowledge_root(&app)?;
    let path = board_path(&root, &args.space_id, &args.board_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
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
    // Doc gone (delete in flight / already cleaned) — do not recreate versions/.
    if !doc.exists() {
        return Ok(None);
    }
    let body = fs::read_to_string(&doc).map_err(|e| e.to_string())?;
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
pub struct ExportTextArgs {
    pub dest_path: String,
    pub body: String,
}

/// Write arbitrary text (e.g. HTML export) to an absolute path.
#[tauri::command]
pub fn knowledge_export_text(_app: AppHandle, args: ExportTextArgs) -> Result<(), String> {
    if args.body.len() > 25 * 1024 * 1024 {
        return Err("export body too large".into());
    }
    let dest = PathBuf::from(&args.dest_path);
    if !dest.is_absolute() {
        return Err("destPath must be absolute".into());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write_str(&dest, &args.body)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpaceZipArgs {
    pub space_id: String,
    pub dest_path: String,
}

/// Portable hip layout (K17): meta.json + tree.json + docs/ + assets/.
/// Space-root-relative `assets/…` links in MD survive re-import.
#[tauri::command]
pub fn knowledge_export_space_zip(app: AppHandle, args: ExportSpaceZipArgs) -> Result<(), String> {
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let root = knowledge_root(&app)?;
    require_id(&args.space_id, "spaceId")?;
    let dir = space_dir(&root, &args.space_id)?;
    if !dir.exists() {
        return Err("space not found".into());
    }
    let tree: KnowledgeTreeFile = if dir.join("tree.json").exists() {
        read_json_file(&dir.join("tree.json"))?
    } else {
        KnowledgeTreeFile {
            version: 1,
            nodes: vec![],
        }
    };
    let dest = PathBuf::from(&args.dest_path);
    if !dest.is_absolute() {
        return Err("destPath must be absolute".into());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
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

    // meta.json (prefer on-disk; fall back to index entry)
    let meta_bytes = if dir.join("meta.json").exists() {
        fs::read(&dir.join("meta.json")).map_err(|e| e.to_string())?
    } else {
        let index = load_index(&root)?;
        let space = index
            .spaces
            .iter()
            .find(|s| s.id == args.space_id)
            .ok_or_else(|| "space not found in index".to_string())?;
        serde_json::to_vec_pretty(space).map_err(|e| e.to_string())?
    };
    zip.start_file("meta.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(&meta_bytes).map_err(|e| e.to_string())?;

    let tree_bytes = serde_json::to_vec_pretty(&tree).map_err(|e| e.to_string())?;
    zip.start_file("tree.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(&tree_bytes).map_err(|e| e.to_string())?;

    for n in &tree.nodes {
        if n.kind != "doc" {
            continue;
        }
        let entry_name = format!("docs/{}.md", n.id);
        if !is_safe_zip_entry(&entry_name) {
            return Err("illegal export path".into());
        }
        let body = {
            let p = doc_path(&root, &args.space_id, &n.id)?;
            if p.exists() {
                fs::read(&p).map_err(|e| e.to_string())?
            } else {
                Vec::new()
            }
        };
        zip.start_file(entry_name, opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&body).map_err(|e| e.to_string())?;
    }

    // assets/** (nested dirs; skip symlinks)
    let assets_dir = dir.join("assets");
    if assets_dir.is_dir() {
        walk_assets_for_zip(&assets_dir, "assets", &mut zip, opts)?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn walk_assets_for_zip(
    dir: &Path,
    zip_prefix: &str,
    zip: &mut zip::ZipWriter<fs::File>,
    opts: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write as _;
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for ent in entries.flatten() {
        let path = ent.path();
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let name = ent.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let entry_name = format!("{zip_prefix}/{name_str}");
        if !is_safe_zip_entry(&entry_name) {
            return Err("illegal asset export path".into());
        }
        if meta.is_dir() {
            walk_assets_for_zip(&path, &entry_name, zip, opts)?;
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        zip.start_file(entry_name, opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Assets (P1.5 / K16) ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMeta {
    pub rel_path: String,
    pub mime: String,
    pub byte_length: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssetFromPathArgs {
    pub space_id: String,
    pub source_path: String,
}

#[tauri::command]
pub fn knowledge_import_asset_from_path(
    app: AppHandle,
    args: ImportAssetFromPathArgs,
) -> Result<AssetMeta, String> {
    let root = knowledge_root(&app)?;
    let space = space_dir(&root, &args.space_id)?;
    if !space.exists() {
        return Err("space not found".into());
    }
    let source = PathBuf::from(&args.source_path);
    if !source.is_absolute() {
        return Err("sourcePath must be absolute".into());
    }
    let meta = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("source path is a symlink".into());
    }
    if !meta.is_file() {
        return Err("sourcePath must be a file".into());
    }
    let byte_length = meta.len();
    if byte_length > KNOWLEDGE_ASSET_MAX_BYTES {
        return Err(format!(
            "asset exceeds max size ({KNOWLEDGE_ASSET_MAX_BYTES} bytes)"
        ));
    }
    let mime = mime_from_ext(&source).ok_or_else(|| "unsupported asset type".to_string())?;
    if !allowed_asset_mime(mime) {
        return Err("unsupported asset MIME type".into());
    }
    let file_name = source
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let rel_path = gen_asset_rel_path(file_name);
    let dest = asset_path(&root, &args.space_id, &rel_path)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;
    Ok(AssetMeta {
        rel_path,
        mime: mime.to_string(),
        byte_length,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssetBytesArgs {
    pub space_id: String,
    pub base64: String,
    pub file_name: String,
    pub mime: String,
}

#[tauri::command]
pub fn knowledge_import_asset_bytes(
    app: AppHandle,
    args: ImportAssetBytesArgs,
) -> Result<AssetMeta, String> {
    let root = knowledge_root(&app)?;
    let space = space_dir(&root, &args.space_id)?;
    if !space.exists() {
        return Err("space not found".into());
    }
    let mime = args.mime.trim().to_ascii_lowercase();
    if !allowed_asset_mime(&mime) {
        return Err("unsupported asset MIME type".into());
    }
    let bytes = B64
        .decode(args.base64.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    let byte_length = bytes.len() as u64;
    if byte_length > KNOWLEDGE_ASSET_INLINE_MAX_BYTES {
        return Err(format!(
            "asset exceeds inline max ({KNOWLEDGE_ASSET_INLINE_MAX_BYTES} bytes)"
        ));
    }
    if byte_length == 0 {
        return Err("empty asset".into());
    }
    let mut file_name = args.file_name.trim().to_string();
    if file_name.is_empty() {
        let ext = ext_for_mime(&mime).unwrap_or("bin");
        file_name = format!("paste.{ext}");
    } else if Path::new(&file_name).extension().is_none() {
        if let Some(ext) = ext_for_mime(&mime) {
            file_name = format!("{file_name}.{ext}");
        }
    }
    let rel_path = gen_asset_rel_path(&file_name);
    let dest = asset_path(&root, &args.space_id, &rel_path)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(&dest, &bytes)?;
    Ok(AssetMeta {
        rel_path,
        mime,
        byte_length,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRelArgs {
    pub space_id: String,
    pub rel_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub mime: String,
    pub base64: String,
}

#[tauri::command]
pub fn knowledge_read_asset_data(
    app: AppHandle,
    args: AssetRelArgs,
) -> Result<AssetData, String> {
    let root = knowledge_root(&app)?;
    let path = asset_path(&root, &args.space_id, &args.rel_path)?;
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("asset is a symlink".into());
    }
    if !meta.is_file() {
        return Err("asset not found".into());
    }
    if meta.len() > KNOWLEDGE_ASSET_INLINE_MAX_BYTES {
        return Err(format!(
            "asset exceeds inline max ({KNOWLEDGE_ASSET_INLINE_MAX_BYTES} bytes)"
        ));
    }
    let mime = mime_from_ext(&path).ok_or_else(|| "unsupported asset type".to_string())?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(AssetData {
        mime: mime.to_string(),
        base64: B64.encode(bytes),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetAbsPath {
    pub absolute_path: String,
}

#[tauri::command]
pub fn knowledge_asset_abs_path(
    app: AppHandle,
    args: AssetRelArgs,
) -> Result<AssetAbsPath, String> {
    let root = knowledge_root(&app)?;
    let path = asset_path(&root, &args.space_id, &args.rel_path)?;
    Ok(AssetAbsPath {
        absolute_path: path.to_string_lossy().to_string(),
    })
}

/// Reveal any path under the space root (docs or assets). Shared safe_join with reveal_doc.
#[tauri::command]
pub fn knowledge_reveal_path(app: AppHandle, args: AssetRelArgs) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = knowledge_root(&app)?;
    let space = space_dir(&root, &args.space_id)?;
    if !space.exists() {
        return Err("space not found".into());
    }
    let trimmed = args.rel_path.trim().trim_start_matches("./");
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    // Only allow docs/… or assets/… under space.
    let first = trimmed.split(['/', '\\']).next().unwrap_or("");
    if first != "docs" && first != "assets" {
        return Err("path must be under docs/ or assets/".into());
    }
    let path = safe_join(&space, trimmed).ok_or_else(|| "illegal path".to_string())?;
    // Ensure resolved path stays under space (safe_join already rejects ..).
    let target = if path.is_file() {
        path.as_path()
    } else if path.is_dir() {
        path.as_path()
    } else if let Some(parent) = path.parent() {
        parent
    } else {
        space.as_path()
    };
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|e| e.to_string())
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

/// Portable hip export/import: `tree.json` + `docs/` at the folder root.
fn is_hip_portable_layout(source: &Path) -> bool {
    source.join("tree.json").is_file() && source.join("docs").is_dir()
}

/// Import a portable hip layout folder (meta/tree/docs/assets) into a new space.
fn import_hip_portable_folder(
    app: &AppHandle,
    source: &Path,
    source_canon: &Path,
) -> Result<ImportFolderResult, String> {
    // Prefer meta.json name when present.
    let name = if source.join("meta.json").is_file() {
        read_json_file::<KnowledgeSpace>(&source.join("meta.json"))
            .ok()
            .map(|m| m.name)
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| {
                source
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Imported")
                    .to_string()
            })
    } else {
        source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Imported")
            .to_string()
    };

    let space = knowledge_create_space(
        app.clone(),
        CreateSpaceArgs {
            name,
            icon: None,
        },
    )?;
    let root = knowledge_root(app)?;
    let space_root = space_dir(&root, &space.id)?;

    let tree: KnowledgeTreeFile = match read_json_file(&source.join("tree.json")) {
        Ok(t) => t,
        Err(e) => {
            let _ = knowledge_delete_space(
                app.clone(),
                DeleteSpaceArgs {
                    id: space.id.clone(),
                },
            );
            return Err(e);
        }
    };

    let mut imported = 0u32;
    let docs_src = source.join("docs");
    for n in &tree.nodes {
        if n.kind != "doc" {
            continue;
        }
        if imported >= MAX_IMPORT_DOCS {
            let _ = knowledge_delete_space(
                app.clone(),
                DeleteSpaceArgs {
                    id: space.id.clone(),
                },
            );
            return Err(format!("import exceeds max documents ({MAX_IMPORT_DOCS})"));
        }
        if !n.id.starts_with("doc_") || !is_knowledge_id(&n.id) {
            let _ = knowledge_delete_space(
                app.clone(),
                DeleteSpaceArgs {
                    id: space.id.clone(),
                },
            );
            return Err(format!("invalid doc id in tree: {}", n.id));
        }
        let src_doc = docs_src.join(format!("{}.md", n.id));
        // Skip symlink escape
        if src_doc.exists() {
            let meta = fs::symlink_metadata(&src_doc).map_err(|e| e.to_string());
            let meta = match meta {
                Ok(m) => m,
                Err(e) => {
                    let _ = knowledge_delete_space(
                        app.clone(),
                        DeleteSpaceArgs {
                            id: space.id.clone(),
                        },
                    );
                    return Err(e);
                }
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if let Ok(canon) = src_doc.canonicalize() {
                if !canon.starts_with(source_canon) {
                    continue;
                }
            }
        }
        let body = if src_doc.is_file() {
            fs::read_to_string(&src_doc).unwrap_or_default()
        } else {
            String::new()
        };
        let dest = match doc_path(&root, &space.id, &n.id) {
            Ok(p) => p,
            Err(e) => {
                let _ = knowledge_delete_space(
                    app.clone(),
                    DeleteSpaceArgs {
                        id: space.id.clone(),
                    },
                );
                return Err(e);
            }
        };
        if let Err(e) = atomic_write_str(&dest, &body) {
            let _ = knowledge_delete_space(
                app.clone(),
                DeleteSpaceArgs {
                    id: space.id.clone(),
                },
            );
            return Err(e);
        }
        imported += 1;
    }

    // Copy assets (flat files only)
    let assets_src = source.join("assets");
    if assets_src.is_dir() {
        let assets_dst = space_root.join("assets");
        if let Err(e) = fs::create_dir_all(&assets_dst) {
            let _ = knowledge_delete_space(
                app.clone(),
                DeleteSpaceArgs {
                    id: space.id.clone(),
                },
            );
            return Err(e.to_string());
        }
        let entries = match fs::read_dir(&assets_src) {
            Ok(e) => e,
            Err(e) => {
                let _ = knowledge_delete_space(
                    app.clone(),
                    DeleteSpaceArgs {
                        id: space.id.clone(),
                    },
                );
                return Err(e.to_string());
            }
        };
        for ent in entries.flatten() {
            let path = ent.path();
            let meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() || !meta.is_file() {
                continue;
            }
            let name = ent.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') {
                continue;
            }
            if let Ok(canon) = path.canonicalize() {
                if !canon.starts_with(source_canon) {
                    continue;
                }
            }
            if meta.len() > KNOWLEDGE_ASSET_MAX_BYTES {
                continue;
            }
            // Only allowlisted extensions
            if mime_from_ext(&path).is_none() {
                continue;
            }
            let dest = match safe_join(&assets_dst, &name_str) {
                Some(p) => p,
                None => continue,
            };
            let _ = fs::copy(&path, &dest);
        }
    }

    if let Err(e) = write_json_file(&space_root.join("tree.json"), &tree) {
        let _ = knowledge_delete_space(
            app.clone(),
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

    if is_hip_portable_layout(&source) {
        return import_hip_portable_folder(&app, &source, &source_canon);
    }

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

// ── Templates (P1.7) ──────────────────────────────────────────────────────

fn is_template_id(id: &str) -> bool {
    let (prefix, rest) = match id.split_once('_') {
        Some(p) => p,
        None => return false,
    };
    if prefix != "tpl" {
        return false;
    }
    let len = rest.len();
    if len < 6 || len > 64 {
        return false;
    }
    rest.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn require_template_id(id: &str) -> Result<(), String> {
    if is_template_id(id) {
        Ok(())
    } else {
        Err(format!("invalid templateId: {id}"))
    }
}

fn templates_dir(root: &Path, space_id: &str) -> Result<PathBuf, String> {
    let space = space_dir(root, space_id)?;
    safe_join(&space, "templates").ok_or_else(|| "illegal templates path".to_string())
}

fn template_body_path(root: &Path, space_id: &str, tpl_id: &str) -> Result<PathBuf, String> {
    require_template_id(tpl_id)?;
    let dir = templates_dir(root, space_id)?;
    let file = format!("{tpl_id}.md");
    safe_join(&dir, &file).ok_or_else(|| "illegal template path".to_string())
}

fn templates_manifest_path(root: &Path, space_id: &str) -> Result<PathBuf, String> {
    let dir = templates_dir(root, space_id)?;
    // Fixed name — no user-controlled component.
    Ok(dir.join("templates.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateMeta {
    id: String,
    name: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplatesManifest {
    version: u32,
    templates: Vec<TemplateMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTemplate {
    pub id: String,
    pub name: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn load_templates_manifest(root: &Path, space_id: &str) -> Result<TemplatesManifest, String> {
    let path = templates_manifest_path(root, space_id)?;
    if !path.exists() {
        return Ok(TemplatesManifest {
            version: 1,
            templates: vec![],
        });
    }
    read_json_file(&path)
}

fn save_templates_manifest(
    root: &Path,
    space_id: &str,
    manifest: &TemplatesManifest,
) -> Result<(), String> {
    let path = templates_manifest_path(root, space_id)?;
    write_json_file(&path, manifest)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTemplatesArgs {
    pub space_id: String,
}

#[tauri::command]
pub fn knowledge_list_templates(
    app: AppHandle,
    args: ListTemplatesArgs,
) -> Result<Vec<KnowledgeTemplate>, String> {
    let root = knowledge_root(&app)?;
    let dir = space_dir(&root, &args.space_id)?;
    if !dir.exists() {
        return Err("space not found".into());
    }
    let manifest = load_templates_manifest(&root, &args.space_id)?;
    let mut out = Vec::with_capacity(manifest.templates.len());
    for meta in manifest.templates {
        let body_path = template_body_path(&root, &args.space_id, &meta.id)?;
        let body = if body_path.exists() {
            fs::read_to_string(&body_path).map_err(|e| e.to_string())?
        } else {
            String::new()
        };
        out.push(KnowledgeTemplate {
            id: meta.id,
            name: meta.name,
            body,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        });
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplateArgs {
    pub space_id: String,
    /// When set, update existing template; otherwise create.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub body: String,
}

#[tauri::command]
pub fn knowledge_save_template(
    app: AppHandle,
    args: SaveTemplateArgs,
) -> Result<KnowledgeTemplate, String> {
    let root = knowledge_root(&app)?;
    let dir = space_dir(&root, &args.space_id)?;
    if !dir.exists() {
        return Err("space not found".into());
    }
    let name = args.name.trim();
    if name.is_empty() {
        return Err("template name is empty".into());
    }
    let mut manifest = load_templates_manifest(&root, &args.space_id)?;
    let ts = now_ms();

    let (id, created_at) = if let Some(ref existing) = args.id {
        require_template_id(existing)?;
        let pos = manifest
            .templates
            .iter()
            .position(|t| t.id == *existing)
            .ok_or_else(|| "template not found".to_string())?;
        let created = manifest.templates[pos].created_at;
        manifest.templates[pos].name = name.to_string();
        manifest.templates[pos].updated_at = ts;
        (existing.clone(), created)
    } else {
        let id = gen_id("tpl");
        manifest.templates.push(TemplateMeta {
            id: id.clone(),
            name: name.to_string(),
            created_at: ts,
            updated_at: ts,
        });
        (id, ts)
    };

    let body_path = template_body_path(&root, &args.space_id, &id)?;
    atomic_write_str(&body_path, &args.body)?;
    save_templates_manifest(&root, &args.space_id, &manifest)?;

    Ok(KnowledgeTemplate {
        id,
        name: name.to_string(),
        body: args.body,
        created_at,
        updated_at: ts,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTemplateArgs {
    pub space_id: String,
    pub id: String,
}

#[tauri::command]
pub fn knowledge_delete_template(app: AppHandle, args: DeleteTemplateArgs) -> Result<(), String> {
    require_template_id(&args.id)?;
    let root = knowledge_root(&app)?;
    let dir = space_dir(&root, &args.space_id)?;
    if !dir.exists() {
        return Err("space not found".into());
    }
    let mut manifest = load_templates_manifest(&root, &args.space_id)?;
    let before = manifest.templates.len();
    manifest.templates.retain(|t| t.id != args.id);
    if manifest.templates.len() == before {
        return Err("template not found".into());
    }
    // Manifest first, then body file (orphan body OK on crash).
    save_templates_manifest(&root, &args.space_id, &manifest)?;
    let body_path = template_body_path(&root, &args.space_id, &args.id)?;
    if body_path.exists() {
        let _ = fs::remove_file(&body_path);
    }
    Ok(())
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
        assert!(is_knowledge_id("brd_board0001ab"));
        assert!(!is_knowledge_id("brd_ab")); // too short
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
    fn board_path_rejects_bad_ids() {
        let root = Path::new("/tmp/kb");
        assert!(board_path(root, "bad", "brd_abc123def456").is_err());
        assert!(board_path(root, "spc_oktoken1", "doc_notaboard1").is_err());
        assert!(board_path(root, "spc_oktoken1", "nod_notaboard1").is_err());
        let ok = board_path(root, "spc_oktoken1", "brd_abc123def456").unwrap();
        assert!(
            ok.ends_with("boards/brd_abc123def456.excalidraw")
                || ok.ends_with("boards\\brd_abc123def456.excalidraw")
        );
    }

    #[test]
    fn board_write_rejects_dataurl_field_allows_text_substring() {
        // files.*.dataURL key → reject
        let bad = r#"{"type":"excalidraw","files":{"f1":{"id":"f1","mimeType":"image/png","dataURL":"data:image/png;base64,xx"}}}"#;
        assert!(assert_no_data_url_in_board_json(bad)
            .unwrap_err()
            .contains("dataURL"));

        // element text containing substring dataURL → allow
        let ok = r#"{"type":"excalidraw","elements":[{"type":"text","text":"see dataURL docs"}],"files":{"f1":{"id":"f1","mimeType":"image/png","hipAssetRel":"assets/ast_x.png"}}}"#;
        assert!(assert_no_data_url_in_board_json(ok).is_ok());

        // hipAssetRel only → allow
        let ok2 = r#"{"type":"excalidraw","files":{"f1":{"id":"f1","hipAssetRel":"assets/a.png"}}}"#;
        assert!(assert_no_data_url_in_board_json(ok2).is_ok());
    }

    #[test]
    fn board_write_rejects_oversize_body() {
        let over = "x".repeat(KNOWLEDGE_BOARD_MAX_BYTES + 1);
        let err = validate_board_write_body(&over).unwrap_err();
        assert!(err.contains("exceeds"), "{err}");
    }

    #[test]
    fn board_read_write_helpers_roundtrip() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            let space_id = "spc_boardtest01";
            let board_id = "brd_boardtest01";
            let dir = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(dir.join("boards")).unwrap();
            let path = board_path(&root, space_id, board_id).unwrap();
            let body = EMPTY_BOARD_SCENE_JSON;
            validate_board_write_body(body).unwrap();
            atomic_write_str(&path, body).unwrap();
            assert!(path.is_file());
            let read = fs::read_to_string(&path).unwrap();
            assert!(read.contains("excalidraw"));
            assert!(read.contains("\"source\":\"hip\""));
        });
    }

    #[test]
    fn validate_tree_nodes_kind_prefix() {
        let ok = vec![
            KnowledgeNode {
                id: "nod_folder001".into(),
                parent_id: None,
                kind: "folder".into(),
                title: "F".into(),
                order: 0,
                created_at: 1,
                updated_at: 1,
            },
            KnowledgeNode {
                id: "brd_board0001".into(),
                parent_id: Some("nod_folder001".into()),
                kind: "board".into(),
                title: "B".into(),
                order: 0,
                created_at: 1,
                updated_at: 1,
            },
        ];
        assert!(validate_tree_nodes(&ok).is_ok());
        let bad = vec![KnowledgeNode {
            id: "doc_wrongboard1".into(),
            parent_id: None,
            kind: "board".into(),
            title: "B".into(),
            order: 0,
            created_at: 1,
            updated_at: 1,
        }];
        assert!(validate_tree_nodes(&bad).unwrap_err().contains("prefix"));
    }

    #[test]
    fn asset_path_rejects_traversal_allows_nested() {
        let root = Path::new("/tmp/kb-assets");
        assert!(asset_path(root, "spc_oktoken1", "assets/../evil.png").is_err());
        assert!(asset_path(root, "spc_oktoken1", "../evil.png").is_err());
        assert!(asset_path(root, "spc_oktoken1", "docs/doc_x.md").is_err());
        assert!(asset_path(root, "bad", "assets/x.png").is_err());
        let nested = asset_path(root, "spc_oktoken1", "assets/sub/x.png").unwrap();
        assert!(
            nested.ends_with("assets/sub/x.png") || nested.ends_with("assets\\sub\\x.png")
        );
        let ok = asset_path(root, "spc_oktoken1", "assets/ast_abc123_x.png").unwrap();
        assert!(ok.ends_with("assets/ast_abc123_x.png") || ok.ends_with("assets\\ast_abc123_x.png"));
        let bare = asset_path(root, "spc_oktoken1", "ast_abc123_x.png").unwrap();
        assert!(bare.to_string_lossy().contains("assets"));
    }

    #[test]
    fn mime_allowlist_and_ext() {
        assert!(allowed_asset_mime("image/png"));
        assert!(allowed_asset_mime("application/pdf"));
        assert!(!allowed_asset_mime("image/svg+xml"));
        assert!(!allowed_asset_mime("text/html"));
        assert_eq!(mime_from_ext(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(mime_from_ext(Path::new("a.exe")), None);
        assert_eq!(ext_for_mime("image/jpeg"), Some("jpg"));
    }

    #[test]
    fn sanitize_asset_filename_strips_path_and_controls() {
        assert_eq!(sanitize_asset_filename("../../x.png"), "x.png");
        assert_eq!(sanitize_asset_filename("a b.png"), "a_b.png");
        assert!(!sanitize_asset_filename("").is_empty());
    }

    #[test]
    fn import_write_read_asset_roundtrip_helpers() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            let space_id = "spc_assettest01";
            let dir = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(dir.join("docs")).unwrap();
            fs::create_dir_all(dir.join("assets")).unwrap();

            let png_header: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
            let rel = "assets/ast_test01_pic.png";
            let dest = asset_path(&root, space_id, rel).unwrap();
            atomic_write(&dest, png_header).unwrap();
            assert!(dest.is_file());
            assert_eq!(fs::metadata(&dest).unwrap().len(), png_header.len() as u64);

            // Inline cap refusal
            assert!(KNOWLEDGE_ASSET_INLINE_MAX_BYTES < KNOWLEDGE_ASSET_MAX_BYTES);
            assert_eq!(KNOWLEDGE_ASSET_INLINE_MAX_BYTES, 1_500_000);
            assert_eq!(KNOWLEDGE_ASSET_MAX_BYTES, 25 * 1024 * 1024);
        });
    }

    #[test]
    fn portable_zip_layout_structure() {
        with_temp_root(|base| {
            use std::io::Read;
            use zip::ZipArchive;

            let root = base.join("knowledge");
            let space_id = "spc_ziptest01";
            let dir = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(dir.join("docs")).unwrap();
            fs::create_dir_all(dir.join("assets")).unwrap();
            let space = KnowledgeSpace {
                id: space_id.to_string(),
                name: "ZipTest".into(),
                icon: None,
                created_at: 1,
                updated_at: 1,
            };
            write_json_file(&dir.join("meta.json"), &space).unwrap();
            let doc_id = "doc_ziptest01";
            let tree = KnowledgeTreeFile {
                version: 1,
                nodes: vec![KnowledgeNode {
                    id: doc_id.into(),
                    parent_id: None,
                    kind: "doc".into(),
                    title: "Hello".into(),
                    order: 0,
                    created_at: 1,
                    updated_at: 1,
                }],
            };
            write_json_file(&dir.join("tree.json"), &tree).unwrap();
            atomic_write_str(
                &doc_path(&root, space_id, doc_id).unwrap(),
                "![x](assets/ast_ziptest01_a.png)\n",
            )
            .unwrap();
            atomic_write(
                &asset_path(&root, space_id, "assets/ast_ziptest01_a.png").unwrap(),
                b"fakepng",
            )
            .unwrap();
            save_index(
                &root,
                &KnowledgeIndex {
                    version: 1,
                    spaces: vec![space],
                },
            )
            .unwrap();

            // Build portable zip without AppHandle (inline the same layout rules).
            let dest = base.join("out.zip");
            {
                use std::io::Write as _;
                use zip::write::SimpleFileOptions;
                use zip::ZipWriter;
                let file = fs::File::create(&dest).unwrap();
                let mut zip = ZipWriter::new(file);
                let opts =
                    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
                let meta_bytes = fs::read(dir.join("meta.json")).unwrap();
                zip.start_file("meta.json", opts).unwrap();
                zip.write_all(&meta_bytes).unwrap();
                let tree_bytes = fs::read(dir.join("tree.json")).unwrap();
                zip.start_file("tree.json", opts).unwrap();
                zip.write_all(&tree_bytes).unwrap();
                zip.start_file(format!("docs/{doc_id}.md"), opts).unwrap();
                zip.write_all(b"![x](assets/ast_ziptest01_a.png)\n")
                    .unwrap();
                zip.start_file("assets/ast_ziptest01_a.png", opts).unwrap();
                zip.write_all(b"fakepng").unwrap();
                zip.finish().unwrap();
            }

            let f = fs::File::open(&dest).unwrap();
            let mut archive = ZipArchive::new(f).unwrap();
            let mut names: Vec<String> = (0..archive.len())
                .map(|i| archive.by_index(i).unwrap().name().to_string())
                .collect();
            names.sort();
            assert!(names.iter().any(|n| n == "meta.json"));
            assert!(names.iter().any(|n| n == "tree.json"));
            assert!(names.iter().any(|n| n == &format!("docs/{doc_id}.md")));
            assert!(names.iter().any(|n| n == "assets/ast_ziptest01_a.png"));
            // Not the old human-readable title paths
            assert!(!names.iter().any(|n| n == "Hello.md"));

            let mut body = String::new();
            archive
                .by_name(&format!("docs/{doc_id}.md"))
                .unwrap()
                .read_to_string(&mut body)
                .unwrap();
            assert!(body.contains("assets/ast_ziptest01_a.png"));
        });
    }

    #[test]
    fn is_hip_portable_layout_detects_tree_and_docs() {
        with_temp_root(|base| {
            assert!(!is_hip_portable_layout(base));
            fs::write(base.join("tree.json"), "{}").unwrap();
            assert!(!is_hip_portable_layout(base));
            fs::create_dir_all(base.join("docs")).unwrap();
            assert!(is_hip_portable_layout(base));
        });
    }

    #[test]
    fn template_id_validation() {
        assert!(!is_template_id(""));
        assert!(!is_template_id("doc_abc123def456"));
        assert!(!is_template_id("tpl_ab")); // too short
        assert!(!is_template_id("tpl_../evil"));
        assert!(!is_template_id("tpl_a/b"));
        assert!(is_template_id("tpl_abc123def456"));
        assert!(is_template_id("tpl_xYzAbCdEfGhI"));
    }

    #[test]
    fn template_path_rejects_traversal() {
        let root = Path::new("/tmp/kb");
        assert!(template_body_path(root, "spc_oktoken1", "tpl_../evil").is_err());
        assert!(template_body_path(root, "bad", "tpl_abc123def456").is_err());
        assert!(template_body_path(root, "spc_oktoken1", "tpl_abc123def456").is_ok());
    }

    #[test]
    fn templates_roundtrip_list_save_delete() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            let space_id = "spc_tplspace01";
            let dir = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(dir.join("docs")).unwrap();
            write_json_file(
                &dir.join("meta.json"),
                &KnowledgeSpace {
                    id: space_id.into(),
                    name: "T".into(),
                    icon: None,
                    created_at: 1,
                    updated_at: 1,
                },
            )
            .unwrap();

            // Empty list when no templates dir.
            let empty = load_templates_manifest(&root, space_id).unwrap();
            assert!(empty.templates.is_empty());

            let id = "tpl_meetnotes01";
            let mut manifest = TemplatesManifest {
                version: 1,
                templates: vec![TemplateMeta {
                    id: id.into(),
                    name: "Meeting".into(),
                    created_at: 10,
                    updated_at: 10,
                }],
            };
            let body_path = template_body_path(&root, space_id, id).unwrap();
            atomic_write_str(&body_path, "# Agenda\n").unwrap();
            save_templates_manifest(&root, space_id, &manifest).unwrap();

            let loaded = load_templates_manifest(&root, space_id).unwrap();
            assert_eq!(loaded.templates.len(), 1);
            assert_eq!(loaded.templates[0].name, "Meeting");
            assert_eq!(fs::read_to_string(&body_path).unwrap(), "# Agenda\n");

            // Delete from manifest + body.
            manifest.templates.clear();
            save_templates_manifest(&root, space_id, &manifest).unwrap();
            let _ = fs::remove_file(&body_path);
            assert!(!body_path.exists());
            assert!(load_templates_manifest(&root, space_id)
                .unwrap()
                .templates
                .is_empty());
        });
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

    #[test]
    fn version_skip_when_doc_missing_does_not_create_dir() {
        with_temp_root(|base| {
            let root = base.join("knowledge");
            let space_id = "spc_oktoken1";
            let doc_id = "doc_abc123def456";
            let space = space_dir(&root, space_id).unwrap();
            fs::create_dir_all(space.join("docs")).unwrap();
            // No doc file written.
            let skipped = save_version_inner(&root, space_id, doc_id, "daily", Some("2026-07-14"))
                .unwrap();
            assert!(skipped.is_none());
            let vdir = versions_dir(&root, space_id, doc_id).unwrap();
            assert!(!vdir.exists());
            let skipped_manual = save_version_inner(&root, space_id, doc_id, "manual", None).unwrap();
            assert!(skipped_manual.is_none());
            assert!(!vdir.exists());
        });
    }
}
