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

#[tauri::command]
pub fn knowledge_create_space(app: AppHandle, args: CreateSpaceArgs) -> Result<KnowledgeSpace, String> {
    let name = args.name.trim();
    if name.is_empty() {
        return Err("space name is empty".into());
    }
    let root = knowledge_root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

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

    let mut index = load_index(&root)?;
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

    let ts = now_ms();
    {
        let s = &mut index.spaces[pos];
        if let Some(name) = args.name {
            let name = name.trim();
            if name.is_empty() {
                return Err("space name is empty".into());
            }
            s.name = name.to_string();
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
    }

    #[test]
    fn reject_path_traversal_dotdot() {
        let dest = Path::new("/tmp/kb-root");
        assert!(safe_join(dest, "../evil").is_none());
        assert!(safe_join(dest, "a/../../b").is_none());
        assert!(safe_join(dest, "spc_oktoken1").is_some());
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
}
