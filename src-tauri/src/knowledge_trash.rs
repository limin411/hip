//! Knowledge recycle-bin: FS quarantine under `~/.hip/trash/knowledge/`.
//! Soft-delete spaces (and doc/folder nodes) with durable manifest status machine.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::knowledge::{
    is_knowledge_id, KnowledgeNode, KnowledgeSpace, KnowledgeTreeFile,
};
use crate::paths;
use crate::skills::safe_join;

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrashEntryStatus {
    PendingMove,
    Ready,
    PendingRestore,
    PendingHardDelete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrashEntityKind {
    Space,
    Doc,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashKnowledgeEntry {
    pub id: String,
    pub status: TrashEntryStatus,
    pub kind: TrashEntityKind,
    pub entity_id: String,
    pub space_id: String,
    pub title: String,
    pub deleted_at: i64,
    /// Relative path under trash/knowledge/
    pub payload_rel: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashManifest {
    version: u32,
    entries: Vec<TrashKnowledgeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpacePayloadMeta {
    space: KnowledgeSpace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodePayloadMeta {
    kind: TrashEntityKind,
    space_id: String,
    entity_id: String,
    title: String,
    parent_id: Option<String>,
    order: i32,
    deleted_at: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn gen_entry_id() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("tentry_{n:x}")
}

fn trash_root(app: &AppHandle) -> Result<PathBuf, String> {
    paths::trash_knowledge_dir(app).ok_or_else(|| "trash knowledge root unavailable".to_string())
}

fn knowledge_root(app: &AppHandle) -> Result<PathBuf, String> {
    paths::knowledge_dir(app).ok_or_else(|| "knowledge root unavailable".to_string())
}

fn manifest_path(trash: &Path) -> PathBuf {
    trash.join("manifest.json")
}

fn load_manifest(trash: &Path) -> Result<TrashManifest, String> {
    let path = manifest_path(trash);
    if !path.exists() {
        return Ok(TrashManifest {
            version: 1,
            entries: vec![],
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_manifest(trash: &Path, m: &TrashManifest) -> Result<(), String> {
    fs::create_dir_all(trash).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    let path = manifest_path(trash);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, raw.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalIndex {
    version: u32,
    spaces: Vec<KnowledgeSpace>,
}

fn load_index(root: &Path) -> Result<LocalIndex, String> {
    let path = root.join("index.json");
    if !path.exists() {
        return Ok(LocalIndex {
            version: 1,
            spaces: vec![],
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_index_spaces(root: &Path, spaces: Vec<KnowledgeSpace>) -> Result<(), String> {
    let idx = LocalIndex {
        version: 1,
        spaces,
    };
    let raw = serde_json::to_string_pretty(&idx).map_err(|e| e.to_string())?;
    let path = root.join("index.json");
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, raw.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

fn require_id(id: &str, label: &str) -> Result<(), String> {
    if is_knowledge_id(id) {
        Ok(())
    } else {
        Err(format!("invalid {label}: {id}"))
    }
}

fn space_live_dir(kroot: &Path, space_id: &str) -> Result<PathBuf, String> {
    require_id(space_id, "spaceId")?;
    safe_join(kroot, space_id).ok_or_else(|| "illegal space path".to_string())
}

// ── Public list DTO ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashListItem {
    pub id: String,
    pub kind: TrashEntityKind,
    pub entity_id: String,
    pub space_id: String,
    pub title: String,
    pub deleted_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

fn to_list_item(e: &TrashKnowledgeEntry) -> TrashListItem {
    TrashListItem {
        id: e.id.clone(),
        kind: e.kind.clone(),
        entity_id: e.entity_id.clone(),
        space_id: e.space_id.clone(),
        title: e.title.clone(),
        deleted_at: e.deleted_at,
        space_name: e.space_name.clone(),
        parent_id: e.parent_id.clone(),
    }
}

// ── Soft-delete space ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftDeleteSpaceArgs {
    pub id: String,
}

#[tauri::command]
pub fn knowledge_soft_delete_space(app: AppHandle, args: SoftDeleteSpaceArgs) -> Result<(), String> {
    require_id(&args.id, "spaceId")?;
    let kroot = knowledge_root(&app)?;
    let trash = trash_root(&app)?;
    fs::create_dir_all(trash.join("spaces")).map_err(|e| e.to_string())?;

    let mut index = load_index(&kroot)?;
    let pos = index
        .spaces
        .iter()
        .position(|s| s.id == args.id)
        .ok_or_else(|| "space not found".to_string())?;
    let space = index.spaces[pos].clone();
    let live_dir = space_live_dir(&kroot, &args.id)?;
    if !live_dir.exists() {
        return Err("space directory missing".into());
    }

    let entry_id = gen_entry_id();
    let deleted_at = now_ms();
    let payload_rel = format!("spaces/{}", args.id);
    let dest = trash.join(&payload_rel);
    if dest.exists() {
        return Err("trash payload already exists for this space".into());
    }

    let mut manifest = load_manifest(&trash)?;
    manifest.entries.push(TrashKnowledgeEntry {
        id: entry_id.clone(),
        status: TrashEntryStatus::PendingMove,
        kind: TrashEntityKind::Space,
        entity_id: args.id.clone(),
        space_id: args.id.clone(),
        title: space.name.clone(),
        deleted_at,
        payload_rel: payload_rel.clone(),
        parent_id: None,
        order: None,
        space_name: Some(space.name.clone()),
    });
    save_manifest(&trash, &manifest)?;

    // Rename first, then update live index (safer for crash: orphan in trash still recoverable).
    fs::rename(&live_dir, &dest).map_err(|e| {
        // roll back manifest entry
        let mut m = load_manifest(&trash).unwrap_or(manifest);
        m.entries.retain(|e| e.id != entry_id);
        let _ = save_manifest(&trash, &m);
        e.to_string()
    })?;

    // Write space meta into payload for restore
    let meta = SpacePayloadMeta { space: space.clone() };
    let _ = fs::write(
        dest.join("trash_meta.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    );

    index.spaces.retain(|s| s.id != args.id);
    save_index_spaces(&kroot, index.spaces)?;

    let mut m = load_manifest(&trash)?;
    if let Some(e) = m.entries.iter_mut().find(|e| e.id == entry_id) {
        e.status = TrashEntryStatus::Ready;
    }
    save_manifest(&trash, &m)?;
    Ok(())
}

// ── Soft-delete nodes (doc or folder subtree) ───────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftDeleteNodesArgs {
    pub space_id: String,
    pub node_ids: Vec<String>,
}

fn collect_subtree(nodes: &[KnowledgeNode], root_id: &str) -> Vec<KnowledgeNode> {
    let mut out = Vec::new();
    let mut stack = vec![root_id.to_string()];
    let by_parent: HashMap<Option<String>, Vec<&KnowledgeNode>> = {
        let mut m: HashMap<Option<String>, Vec<&KnowledgeNode>> = HashMap::new();
        for n in nodes {
            m.entry(n.parent_id.clone()).or_default().push(n);
        }
        m
    };
    let mut seen = HashSet::new();
    while let Some(id) = stack.pop() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if let Some(n) = nodes.iter().find(|n| n.id == id) {
            out.push(n.clone());
            if let Some(children) = by_parent.get(&Some(id.clone())) {
                for c in children {
                    stack.push(c.id.clone());
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn knowledge_soft_delete_nodes(
    app: AppHandle,
    args: SoftDeleteNodesArgs,
) -> Result<Vec<String>, String> {
    require_id(&args.space_id, "spaceId")?;
    if args.node_ids.is_empty() {
        return Ok(vec![]);
    }
    let kroot = knowledge_root(&app)?;
    let trash = trash_root(&app)?;
    fs::create_dir_all(trash.join("docs")).map_err(|e| e.to_string())?;

    let space_dir = space_live_dir(&kroot, &args.space_id)?;
    if !space_dir.exists() {
        return Err("space not found".into());
    }
    let tree_path = space_dir.join("tree.json");
    let tree: KnowledgeTreeFile = if tree_path.exists() {
        let raw = fs::read_to_string(&tree_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())?
    } else {
        KnowledgeTreeFile {
            version: 1,
            nodes: vec![],
        }
    };

    // Backup tree
    let bak = space_dir.join("tree.json.bak");
    if tree_path.exists() {
        fs::copy(&tree_path, &bak).map_err(|e| e.to_string())?;
    }

    let mut removed_ids: HashSet<String> = HashSet::new();
    let mut fragments: Vec<(TrashKnowledgeEntry, Vec<KnowledgeNode>)> = Vec::new();
    let deleted_at = now_ms();

    for root_id in &args.node_ids {
        if removed_ids.contains(root_id) {
            continue;
        }
        require_id(root_id, "nodeId")?;
        let subtree = collect_subtree(&tree.nodes, root_id);
        if subtree.is_empty() {
            continue;
        }
        let root = subtree.iter().find(|n| n.id == *root_id).cloned().unwrap();
        let kind = if root.kind == "folder" {
            TrashEntityKind::Folder
        } else {
            TrashEntityKind::Doc
        };
        let entry_id = gen_entry_id();
        let payload_rel = format!("docs/{entry_id}");
        let entry = TrashKnowledgeEntry {
            id: entry_id.clone(),
            status: TrashEntryStatus::PendingMove,
            kind: kind.clone(),
            entity_id: root_id.clone(),
            space_id: args.space_id.clone(),
            title: root.title.clone(),
            deleted_at,
            payload_rel: payload_rel.clone(),
            parent_id: root.parent_id.clone(),
            order: Some(root.order),
            space_name: None,
        };
        for n in &subtree {
            removed_ids.insert(n.id.clone());
        }
        fragments.push((entry, subtree));
    }

    if fragments.is_empty() {
        let _ = fs::remove_file(&bak);
        return Ok(vec![]);
    }

    let mut manifest = load_manifest(&trash)?;
    for (e, _) in &fragments {
        manifest.entries.push(e.clone());
    }
    save_manifest(&trash, &manifest)?;

    // Move payloads
    for (entry, subtree) in &fragments {
        let dest = trash.join(&entry.payload_rel);
        fs::create_dir_all(dest.join("docs")).map_err(|e| e.to_string())?;
        fs::create_dir_all(dest.join("versions")).map_err(|e| e.to_string())?;

        let meta = NodePayloadMeta {
            kind: entry.kind.clone(),
            space_id: entry.space_id.clone(),
            entity_id: entry.entity_id.clone(),
            title: entry.title.clone(),
            parent_id: entry.parent_id.clone(),
            order: entry.order.unwrap_or(0),
            deleted_at: entry.deleted_at,
        };
        fs::write(
            dest.join("meta.json"),
            serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::write(
            dest.join("treeFragment.json"),
            serde_json::to_string_pretty(subtree).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

        for n in subtree {
            if n.kind != "doc" && !n.id.starts_with("doc_") {
                continue;
            }
            if !n.id.starts_with("doc_") {
                continue;
            }
            let src_md = space_dir.join("docs").join(format!("{}.md", n.id));
            if src_md.exists() {
                let _ = fs::rename(&src_md, dest.join("docs").join(format!("{}.md", n.id)));
            }
            let src_ver = space_dir.join("versions").join(&n.id);
            if src_ver.exists() {
                let _ = fs::rename(&src_ver, dest.join("versions").join(&n.id));
            }
        }
    }

    // Write tree without removed nodes
    let new_nodes: Vec<KnowledgeNode> = tree
        .nodes
        .into_iter()
        .filter(|n| !removed_ids.contains(&n.id))
        .collect();
    let new_tree = KnowledgeTreeFile {
        version: 1,
        nodes: new_nodes,
    };
    fs::write(
        &tree_path,
        serde_json::to_string_pretty(&new_tree).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&bak);

    let mut m = load_manifest(&trash)?;
    for (entry, _) in &fragments {
        if let Some(e) = m.entries.iter_mut().find(|x| x.id == entry.id) {
            e.status = TrashEntryStatus::Ready;
        }
    }
    save_manifest(&trash, &m)?;
    Ok(fragments.iter().map(|(e, _)| e.id.clone()).collect())
}

// ── List / restore / hard / empty / purge / reconcile ───────────────────────

#[tauri::command]
pub fn knowledge_list_trash(app: AppHandle) -> Result<Vec<TrashListItem>, String> {
    let trash = trash_root(&app)?;
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let m = load_manifest(&trash)?;
    let mut items: Vec<TrashListItem> = m
        .entries
        .iter()
        .filter(|e| e.status == TrashEntryStatus::Ready)
        .map(to_list_item)
        .collect();
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(items)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntryIdArgs {
    pub entry_id: String,
}

#[tauri::command]
pub fn knowledge_restore_trash_entry(
    app: AppHandle,
    args: TrashEntryIdArgs,
) -> Result<TrashListItem, String> {
    let kroot = knowledge_root(&app)?;
    let trash = trash_root(&app)?;
    let mut m = load_manifest(&trash)?;
    let idx = m
        .entries
        .iter()
        .position(|e| e.id == args.entry_id)
        .ok_or_else(|| "trash entry not found".to_string())?;
    let entry = m.entries[idx].clone();
    if entry.status != TrashEntryStatus::Ready {
        return Err("trash entry not ready".into());
    }
    let payload = trash.join(&entry.payload_rel);
    if !payload.exists() {
        m.entries.remove(idx);
        save_manifest(&trash, &m)?;
        return Err("trash payload missing".into());
    }

    match entry.kind {
        TrashEntityKind::Space => {
            let mut index = load_index(&kroot)?;
            let mut name = entry.title.clone();
            // Auto-suffix if name taken
            if index
                .spaces
                .iter()
                .any(|s| s.name.trim().eq_ignore_ascii_case(name.trim()))
            {
                let mut n = 1;
                loop {
                    let candidate = if n == 1 {
                        format!("{name} (restored)")
                    } else {
                        format!("{name} (restored {n})")
                    };
                    if !index
                        .spaces
                        .iter()
                        .any(|s| s.name.trim().eq_ignore_ascii_case(candidate.trim()))
                    {
                        name = candidate;
                        break;
                    }
                    n += 1;
                    if n > 50 {
                        return Err("could not allocate restored space name".into());
                    }
                }
            }
            let dest = space_live_dir(&kroot, &entry.entity_id)?;
            if dest.exists() {
                return Err("live space directory already exists".into());
            }
            fs::rename(&payload, &dest).map_err(|e| e.to_string())?;

            // Load space meta
            let mut space = if let Ok(raw) = fs::read_to_string(dest.join("trash_meta.json")) {
                serde_json::from_str::<SpacePayloadMeta>(&raw)
                    .map(|m| m.space)
                    .unwrap_or_else(|_| KnowledgeSpace {
                        id: entry.entity_id.clone(),
                        name: name.clone(),
                        icon: None,
                        created_at: entry.deleted_at,
                        updated_at: now_ms(),
                    })
            } else if let Ok(raw) = fs::read_to_string(dest.join("meta.json")) {
                serde_json::from_str::<KnowledgeSpace>(&raw).unwrap_or(KnowledgeSpace {
                    id: entry.entity_id.clone(),
                    name: name.clone(),
                    icon: None,
                    created_at: entry.deleted_at,
                    updated_at: now_ms(),
                })
            } else {
                KnowledgeSpace {
                    id: entry.entity_id.clone(),
                    name: name.clone(),
                    icon: None,
                    created_at: entry.deleted_at,
                    updated_at: now_ms(),
                }
            };
            space.name = name;
            space.updated_at = now_ms();
            let _ = fs::write(
                dest.join("meta.json"),
                serde_json::to_string_pretty(&space).unwrap_or_default(),
            );
            let _ = fs::remove_file(dest.join("trash_meta.json"));

            index.spaces.push(space);
            save_index_spaces(&kroot, index.spaces)?;
        }
        TrashEntityKind::Doc | TrashEntityKind::Folder => {
            let space_dir = space_live_dir(&kroot, &entry.space_id)?;
            if !space_dir.exists() {
                return Err("parent space missing; restore the space first".into());
            }
            let tree_path = space_dir.join("tree.json");
            let mut tree: KnowledgeTreeFile = if tree_path.exists() {
                let raw = fs::read_to_string(&tree_path).map_err(|e| e.to_string())?;
                serde_json::from_str(&raw).map_err(|e| e.to_string())?
            } else {
                KnowledgeTreeFile {
                    version: 1,
                    nodes: vec![],
                }
            };

            // Parent must exist (or be null root)
            if let Some(ref pid) = entry.parent_id {
                if !tree.nodes.iter().any(|n| n.id == *pid) {
                    return Err("parent_missing".into());
                }
            }

            let frag_raw = fs::read_to_string(payload.join("treeFragment.json"))
                .map_err(|e| e.to_string())?;
            let fragment: Vec<KnowledgeNode> =
                serde_json::from_str(&frag_raw).map_err(|e| e.to_string())?;

            // Id collision check
            for n in &fragment {
                if tree.nodes.iter().any(|x| x.id == n.id) {
                    return Err(format!("node id already exists: {}", n.id));
                }
            }

            // Move docs back
            for n in &fragment {
                if !n.id.starts_with("doc_") {
                    continue;
                }
                let src = payload.join("docs").join(format!("{}.md", n.id));
                if src.exists() {
                    fs::create_dir_all(space_dir.join("docs")).map_err(|e| e.to_string())?;
                    fs::rename(&src, space_dir.join("docs").join(format!("{}.md", n.id)))
                        .map_err(|e| e.to_string())?;
                }
                let src_ver = payload.join("versions").join(&n.id);
                if src_ver.exists() {
                    fs::create_dir_all(space_dir.join("versions")).map_err(|e| e.to_string())?;
                    fs::rename(&src_ver, space_dir.join("versions").join(&n.id))
                        .map_err(|e| e.to_string())?;
                }
            }

            tree.nodes.extend(fragment);
            fs::write(
                &tree_path,
                serde_json::to_string_pretty(&tree).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let _ = fs::remove_dir_all(&payload);
        }
    }

    m.entries.retain(|e| e.id != args.entry_id);
    save_manifest(&trash, &m)?;
    Ok(to_list_item(&entry))
}

#[tauri::command]
pub fn knowledge_hard_delete_trash_entry(
    app: AppHandle,
    args: TrashEntryIdArgs,
) -> Result<(), String> {
    let trash = trash_root(&app)?;
    let mut m = load_manifest(&trash)?;
    let idx = m
        .entries
        .iter()
        .position(|e| e.id == args.entry_id)
        .ok_or_else(|| "trash entry not found".to_string())?;
    let entry = m.entries.remove(idx);
    let payload = trash.join(&entry.payload_rel);
    if payload.exists() {
        let _ = fs::remove_dir_all(&payload);
    }
    save_manifest(&trash, &m)?;
    Ok(())
}

#[tauri::command]
pub fn knowledge_empty_trash(app: AppHandle) -> Result<u32, String> {
    let trash = trash_root(&app)?;
    let m = load_manifest(&trash)?;
    let mut count = 0u32;
    for e in m.entries {
        let payload = trash.join(&e.payload_rel);
        if payload.exists() {
            let _ = fs::remove_dir_all(&payload);
        }
        count += 1;
    }
    save_manifest(
        &trash,
        &TrashManifest {
            version: 1,
            entries: vec![],
        },
    )?;
    Ok(count)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeTrashArgs {
    #[serde(default)]
    pub retention_days: Option<u32>,
}

#[tauri::command]
pub fn knowledge_purge_expired_trash(
    app: AppHandle,
    args: PurgeTrashArgs,
) -> Result<Vec<String>, String> {
    let days = args.retention_days.unwrap_or(7).clamp(1, 365) as i64;
    let cutoff = now_ms() - days * 24 * 60 * 60 * 1000;
    let trash = trash_root(&app)?;
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    // Reconcile first
    let _ = knowledge_reconcile_trash(app.clone());
    let mut m = load_manifest(&trash)?;
    let mut purged = Vec::new();
    let mut keep = Vec::new();
    for e in m.entries.drain(..) {
        if e.status == TrashEntryStatus::Ready && e.deleted_at < cutoff {
            let payload = trash.join(&e.payload_rel);
            if payload.exists() {
                let _ = fs::remove_dir_all(&payload);
            }
            purged.push(e.id);
        } else {
            keep.push(e);
        }
    }
    m.entries = keep;
    save_manifest(&trash, &m)?;
    Ok(purged)
}

#[tauri::command]
pub fn knowledge_reconcile_trash(app: AppHandle) -> Result<u32, String> {
    let kroot = knowledge_root(&app)?;
    let trash = trash_root(&app)?;
    fs::create_dir_all(trash.join("spaces")).map_err(|e| e.to_string())?;
    fs::create_dir_all(trash.join("docs")).map_err(|e| e.to_string())?;
    let mut m = load_manifest(&trash)?;
    let mut fixed = 0u32;

    // pending_move with payload present → ready + remove from live index if space
    for e in m.entries.iter_mut() {
        if e.status != TrashEntryStatus::PendingMove {
            continue;
        }
        let payload = trash.join(&e.payload_rel);
        let live = match e.kind {
            TrashEntityKind::Space => space_live_dir(&kroot, &e.entity_id).ok(),
            _ => None,
        };
        if payload.exists() {
            if e.kind == TrashEntityKind::Space {
                if let Ok(mut index) = load_index(&kroot) {
                    let before = index.spaces.len();
                    index.spaces.retain(|s| s.id != e.entity_id);
                    if index.spaces.len() != before {
                        let _ = save_index_spaces(&kroot, index.spaces);
                    }
                }
            }
            e.status = TrashEntryStatus::Ready;
            fixed += 1;
        } else if live.as_ref().map(|p| p.exists()).unwrap_or(false) {
            // move never happened — drop pending entry
            // (will remove below)
            e.status = TrashEntryStatus::PendingHardDelete; // mark for drop
            fixed += 1;
        }
    }
    m.entries
        .retain(|e| e.status != TrashEntryStatus::PendingHardDelete);

    // Orphan dirs under spaces/ without manifest
    let spaces_dir = trash.join("spaces");
    if spaces_dir.exists() {
        if let Ok(rd) = fs::read_dir(&spaces_dir) {
            for ent in rd.flatten() {
                let name = ent.file_name().to_string_lossy().to_string();
                if !name.starts_with("spc_") {
                    continue;
                }
                let has = m.entries.iter().any(|e| {
                    e.kind == TrashEntityKind::Space && (e.entity_id == name || e.payload_rel.ends_with(&name))
                });
                if !has && ent.path().is_dir() {
                    let entry_id = gen_entry_id();
                    let title = fs::read_to_string(ent.path().join("meta.json"))
                        .ok()
                        .and_then(|r| serde_json::from_str::<KnowledgeSpace>(&r).ok())
                        .map(|s| s.name)
                        .unwrap_or_else(|| name.clone());
                    m.entries.push(TrashKnowledgeEntry {
                        id: entry_id,
                        status: TrashEntryStatus::Ready,
                        kind: TrashEntityKind::Space,
                        entity_id: name.clone(),
                        space_id: name.clone(),
                        title,
                        deleted_at: now_ms(),
                        payload_rel: format!("spaces/{name}"),
                        parent_id: None,
                        order: None,
                        space_name: None,
                    });
                    fixed += 1;
                }
            }
        }
    }

    // Drop ready with missing payload
    let before = m.entries.len();
    m.entries.retain(|e| {
        if e.status != TrashEntryStatus::Ready {
            return true;
        }
        trash.join(&e.payload_rel).exists()
    });
    fixed += (before - m.entries.len()) as u32;

    save_manifest(&trash, &m)?;
    Ok(fixed)
}
