//! Work-item recycle bin under `~/.hip/trash/work-items/manifest.json`.
//! Soft-delete moves a full item snapshot out of `work-items/catalog.json`.

use crate::work_items::{
    default_catalog, load_catalog, save_catalog, WorkItem, WorkItemsCatalog, INBOX_LIST_ID,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsTrashEntry {
    pub id: String,
    pub deleted_at: i64,
    pub item: WorkItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsTrashManifest {
    pub version: u32,
    #[serde(default)]
    pub entries: Vec<WorkItemsTrashEntry>,
}

/// List DTO for the product recycle-bin UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsTrashListItem {
    pub id: String,
    pub item_id: String,
    pub title: String,
    pub deleted_at: i64,
    pub status: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn mint_entry_id() -> String {
    let n = now_ms() as u64 ^ (std::process::id() as u64).wrapping_mul(0x9e37);
    format!("tentry_{n:x}")
}

fn trash_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::trash_work_items_dir(app)
        .ok_or_else(|| "trash work-items root unavailable".to_string())
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::work_items_catalog_path(app).ok_or_else(|| "no work-items dir".to_string())
}

fn manifest_path(trash: &Path) -> PathBuf {
    trash.join("manifest.json")
}

fn empty_manifest() -> WorkItemsTrashManifest {
    WorkItemsTrashManifest {
        version: MANIFEST_VERSION,
        entries: vec![],
    }
}

fn load_manifest(trash: &Path) -> WorkItemsTrashManifest {
    let path = manifest_path(trash);
    match std::fs::read_to_string(&path) {
        Ok(body) => match serde_json::from_str::<WorkItemsTrashManifest>(&body) {
            Ok(mut m) => {
                if m.version != MANIFEST_VERSION {
                    m.version = MANIFEST_VERSION;
                }
                m
            }
            Err(_) => empty_manifest(),
        },
        Err(_) => empty_manifest(),
    }
}

fn save_manifest(trash: &Path, m: &WorkItemsTrashManifest) -> Result<(), String> {
    std::fs::create_dir_all(trash).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    let path = manifest_path(trash);
    crate::atomic_write::atomic_write_private(&path, body.as_bytes()).map_err(|e| e.to_string())
}

fn to_list_item(e: &WorkItemsTrashEntry) -> WorkItemsTrashListItem {
    WorkItemsTrashListItem {
        id: e.id.clone(),
        item_id: e.item.id.clone(),
        title: if e.item.title.trim().is_empty() {
            "Untitled".into()
        } else {
            e.item.title.clone()
        },
        deleted_at: e.deleted_at,
        status: e.item.status.clone(),
    }
}

fn ensure_inbox_list(catalog: &mut WorkItemsCatalog) {
    if catalog.lists.iter().any(|l| l.id == INBOX_LIST_ID) {
        return;
    }
    let def = default_catalog();
    if let Some(inbox) = def.lists.into_iter().next() {
        catalog.lists.insert(0, inbox);
    }
}

/// Soft-delete: remove item from live catalog and quarantine a snapshot.
#[tauri::command]
pub fn work_items_soft_delete(app: AppHandle, id: String) -> Result<WorkItemsTrashListItem, String> {
    let cat_path = catalog_path(&app)?;
    let trash = trash_root(&app)?;
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;

    let mut catalog = load_catalog(&cat_path);
    let pos = catalog
        .items
        .iter()
        .position(|i| i.id == id)
        .ok_or_else(|| format!("work item not found: {id}"))?;
    let item = catalog.items.remove(pos);
    save_catalog(&cat_path, &catalog)?;

    let entry = WorkItemsTrashEntry {
        id: mint_entry_id(),
        deleted_at: now_ms(),
        item,
    };
    let list_item = to_list_item(&entry);

    let mut manifest = load_manifest(&trash);
    // Prefer newest first.
    manifest.entries.insert(0, entry);
    save_manifest(&trash, &manifest)?;

    Ok(list_item)
}

#[tauri::command]
pub fn work_items_list_trash(app: AppHandle) -> Result<Vec<WorkItemsTrashListItem>, String> {
    let trash = trash_root(&app)?;
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let mut entries = load_manifest(&trash).entries;
    entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(entries.iter().map(to_list_item).collect())
}

#[tauri::command]
pub fn work_items_restore_trash_entry(
    app: AppHandle,
    entry_id: String,
) -> Result<WorkItem, String> {
    let trash = trash_root(&app)?;
    let cat_path = catalog_path(&app)?;
    let mut manifest = load_manifest(&trash);
    let pos = manifest
        .entries
        .iter()
        .position(|e| e.id == entry_id)
        .ok_or_else(|| format!("trash entry not found: {entry_id}"))?;
    let entry = manifest.entries.remove(pos);

    let mut catalog = load_catalog(&cat_path);
    ensure_inbox_list(&mut catalog);

    // Avoid id clash if item somehow still lives (or was recreated).
    if catalog.items.iter().any(|i| i.id == entry.item.id) {
        return Err(format!("work item already exists: {}", entry.item.id));
    }

    let mut item = entry.item;
    // If target list was deleted, land in Inbox.
    if !catalog.lists.iter().any(|l| l.id == item.list_id) {
        item.list_id = INBOX_LIST_ID.into();
    }
    item.updated_at = now_ms();
    catalog.items.push(item.clone());
    save_catalog(&cat_path, &catalog)?;
    save_manifest(&trash, &manifest)?;
    Ok(item)
}

#[tauri::command]
pub fn work_items_hard_delete_trash_entry(app: AppHandle, entry_id: String) -> Result<(), String> {
    let trash = trash_root(&app)?;
    let mut manifest = load_manifest(&trash);
    let before = manifest.entries.len();
    manifest.entries.retain(|e| e.id != entry_id);
    if manifest.entries.len() == before {
        return Err(format!("trash entry not found: {entry_id}"));
    }
    save_manifest(&trash, &manifest)
}

#[tauri::command]
pub fn work_items_empty_trash(app: AppHandle) -> Result<u32, String> {
    let trash = trash_root(&app)?;
    let mut manifest = load_manifest(&trash);
    let n = manifest.entries.len() as u32;
    manifest.entries.clear();
    save_manifest(&trash, &manifest)?;
    Ok(n)
}

/// Purge trash entries older than retention days (1–365, default 7).
#[tauri::command]
pub fn work_items_purge_expired_trash(
    app: AppHandle,
    retention_days: Option<u32>,
) -> Result<Vec<String>, String> {
    let days = retention_days.unwrap_or(7).clamp(1, 365) as i64;
    let cutoff = now_ms() - days * 24 * 60 * 60 * 1000;
    let trash = trash_root(&app)?;
    let mut manifest = load_manifest(&trash);
    let mut purged = Vec::new();
    manifest.entries.retain(|e| {
        if e.deleted_at < cutoff {
            purged.push(e.id.clone());
            false
        } else {
            true
        }
    });
    if !purged.is_empty() {
        save_manifest(&trash, &manifest)?;
    }
    Ok(purged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_items::{WorkItem, WorkItemLinks, WorkItemList};

    fn sample_item(id: &str) -> WorkItem {
        WorkItem {
            id: id.into(),
            title: "Trash me".into(),
            status: "todo".into(),
            priority: "none".into(),
            list_id: INBOX_LIST_ID.into(),
            tags: vec![],
            notes: String::new(),
            start_on: None,
            end_on: None,
            due_on: None,
            created_at: 1,
            updated_at: 1,
            completed_at: None,
            archived_at: None,
            links: WorkItemLinks::default(),
        }
    }

    #[test]
    fn manifest_round_trip() {
        let dir = std::env::temp_dir().join(format!(
            "hip-wi-trash-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let m = WorkItemsTrashManifest {
            version: 1,
            entries: vec![WorkItemsTrashEntry {
                id: "tentry_1".into(),
                deleted_at: 99,
                item: sample_item("wi_1"),
            }],
        };
        save_manifest(&dir, &m).unwrap();
        let loaded = load_manifest(&dir);
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.entries[0].item.id, "wi_1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_inbox_adds_when_missing() {
        let mut cat = WorkItemsCatalog {
            version: 1,
            lists: vec![WorkItemList {
                id: "wl_other".into(),
                name: "Other".into(),
                sort_order: 1,
                created_at: 1,
                updated_at: 1,
                system: None,
            }],
            items: vec![],
        };
        ensure_inbox_list(&mut cat);
        assert!(cat.lists.iter().any(|l| l.id == INBOX_LIST_ID));
    }
}
