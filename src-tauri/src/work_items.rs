//! Work item catalog (`~/.hip/work-items/catalog.json`).
//!
//! Product content directory (like knowledge), not under `config/`.
//! IPC shape mirrors terminal-hosts: list/save with flat `{ catalog }` payload.
//! Corrupt files are backed up as `catalog.json.corrupt-<ts>` (stronger than hosts).

use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const INBOX_LIST_ID: &str = "wl_inbox";
const TITLE_MAX: usize = 200;
const NOTES_MAX: usize = 64 * 1024;
const TAGS_MAX: usize = 20;
const TAG_MAX_LEN: usize = 32;
/// Soft hard-cap on serialized catalog body (reject oversized saves).
const CATALOG_MAX_BYTES: usize = 20 * 1024 * 1024;

/// Optional outbound links (session / knowledge / url).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemLinks {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub knowledge: Option<WorkItemKnowledgeRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemKnowledgeRef {
    pub space_id: String,
    pub doc_id: String,
}

/// Product work item — NOT TaskRuntime / write_todos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub list_id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    /// Local calendar date `YYYY-MM-DD`, or null. Never time-of-day / `dueAt`.
    pub due_on: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
    pub archived_at: Option<i64>,
    #[serde(default)]
    pub links: WorkItemLinks,
}

/// User or system list (Inbox).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemList {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
}

/// Full on-disk / IPC catalog (v1, full notes in-file).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsCatalog {
    pub version: u32,
    #[serde(default)]
    pub lists: Vec<WorkItemList>,
    #[serde(default)]
    pub items: Vec<WorkItem>,
}

/// Default Inbox-only catalog (missing / corrupt load recovery).
pub fn default_catalog() -> WorkItemsCatalog {
    WorkItemsCatalog {
        version: 1,
        lists: vec![WorkItemList {
            id: INBOX_LIST_ID.into(),
            name: "Inbox".into(),
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
            system: Some("inbox".into()),
        }],
        items: vec![],
    }
}

fn is_work_item_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("wi_") else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn is_work_list_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("wl_") else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// True when `s` is `YYYY-MM-DD` and a real Gregorian calendar day.
pub fn is_valid_due_on(s: &str) -> bool {
    if s.len() != 10 {
        return false;
    }
    let b = s.as_bytes();
    if b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b[..4].iter().all(u8::is_ascii_digit)
        || !b[5..7].iter().all(u8::is_ascii_digit)
        || !b[8..10].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let y: u32 = match s[..4].parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let m: u32 = match s[5..7].parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    let d: u32 = match s[8..10].parse() {
        Ok(v) => v,
        Err(_) => return false,
    };
    if m < 1 || m > 12 || d < 1 {
        return false;
    }
    let max_d = days_in_month(y, m);
    d <= max_d
}

fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(y) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn is_leap_year(y: u32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

/// Validate catalog before save (Rust is the authority).
pub fn validate_catalog(catalog: &WorkItemsCatalog) -> Result<(), String> {
    if catalog.version != 1 {
        return Err(format!("unsupported catalog version {}", catalog.version));
    }

    let mut list_ids = std::collections::HashSet::new();
    let mut has_inbox = false;

    for list in &catalog.lists {
        if !is_work_list_id(&list.id) {
            return Err(format!("invalid list id: {}", list.id));
        }
        if !list_ids.insert(list.id.clone()) {
            return Err(format!("duplicate list id: {}", list.id));
        }
        if list.id == INBOX_LIST_ID {
            has_inbox = true;
            if list.system.as_deref() != Some("inbox") {
                return Err("wl_inbox must have system:\"inbox\"".into());
            }
        } else if list.system.as_deref() == Some("inbox") {
            return Err(format!("only wl_inbox may have system:\"inbox\" (got {})", list.id));
        }
        if list.name.chars().count() > TITLE_MAX {
            return Err(format!("list name too long: {}", list.id));
        }
    }
    if !has_inbox {
        return Err("catalog must include wl_inbox".into());
    }

    let mut item_ids = std::collections::HashSet::new();
    for item in &catalog.items {
        if !is_work_item_id(&item.id) {
            return Err(format!("invalid item id: {}", item.id));
        }
        if !item_ids.insert(item.id.clone()) {
            return Err(format!("duplicate item id: {}", item.id));
        }
        if !list_ids.contains(&item.list_id) {
            return Err(format!(
                "item {} references unknown listId {}",
                item.id, item.list_id
            ));
        }
        if item.title.chars().count() > TITLE_MAX {
            return Err(format!("title too long: {}", item.id));
        }
        if item.notes.len() > NOTES_MAX {
            return Err(format!("notes too long: {}", item.id));
        }
        if item.tags.len() > TAGS_MAX {
            return Err(format!("too many tags: {}", item.id));
        }
        for tag in &item.tags {
            if tag.chars().count() > TAG_MAX_LEN {
                return Err(format!("tag too long on {}", item.id));
            }
        }
        if let Some(ref due) = item.due_on {
            if !is_valid_due_on(due) {
                return Err(format!("invalid dueOn on {}: {due}", item.id));
            }
        }
        match item.status.as_str() {
            "todo" | "in_progress" | "done" | "cancelled" => {}
            other => return Err(format!("invalid status on {}: {other}", item.id)),
        }
        match item.priority.as_str() {
            "none" | "low" | "medium" | "high" => {}
            other => return Err(format!("invalid priority on {}: {other}", item.id)),
        }
    }

    Ok(())
}

fn backup_corrupt(path: &Path) -> Option<PathBuf> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup_name = format!("catalog.json.corrupt-{ts}");
    let backup = path.with_file_name(backup_name);
    match std::fs::rename(path, &backup) {
        Ok(()) => {
            eprintln!(
                "[tauri] work_items: backed up corrupt catalog to {}",
                backup.display()
            );
            Some(backup)
        }
        Err(e) => {
            eprintln!("[tauri] work_items: failed to backup corrupt catalog: {e}");
            None
        }
    }
}

/// Load catalog. Missing → default Inbox. Corrupt → backup + default.
pub fn load_catalog(path: &Path) -> WorkItemsCatalog {
    match std::fs::read_to_string(path) {
        Ok(body) => match serde_json::from_str::<WorkItemsCatalog>(&body) {
            Ok(cat) => cat,
            Err(_) => {
                let _ = backup_corrupt(path);
                default_catalog()
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => default_catalog(),
        Err(e) => {
            eprintln!("[tauri] work_items: read failed ({}): {e}", path.display());
            default_catalog()
        }
    }
}

/// Persist catalog via shared atomic 0o600 helper.
pub fn save_catalog(path: &Path, catalog: &WorkItemsCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(catalog).map_err(|e| e.to_string())?;
    if body.len() > CATALOG_MAX_BYTES {
        return Err(format!(
            "catalog too large: {} bytes (max {CATALOG_MAX_BYTES})",
            body.len()
        ));
    }
    crate::atomic_write::atomic_write_private(path, body.as_bytes()).map_err(|e| e.to_string())
}

/// Load catalog. Missing file → default Inbox catalog (parent dir created via paths).
/// Corrupt file → rename to `catalog.json.corrupt-<ts>`, return default.
#[tauri::command]
pub fn work_items_list(app: AppHandle) -> Result<WorkItemsCatalog, String> {
    let path = crate::paths::work_items_catalog_path(&app)
        .ok_or_else(|| "no work-items dir".to_string())?;
    Ok(load_catalog(&path))
}

/// Full replace save. Validates version, ids, sizes, dueOn; atomic private write.
#[tauri::command]
pub fn work_items_save(app: AppHandle, catalog: WorkItemsCatalog) -> Result<(), String> {
    let path = crate::paths::work_items_catalog_path(&app)
        .ok_or_else(|| "no work-items dir".to_string())?;
    save_catalog(&path, &catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hip-work-items-test-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("catalog.json")
    }

    fn sample_item() -> WorkItem {
        WorkItem {
            id: "wi_abc123".into(),
            title: "Ship work-items catalog".into(),
            status: "in_progress".into(),
            priority: "high".into(),
            list_id: "wl_work".into(),
            tags: vec!["hip".into(), "v1".into()],
            notes: "Golden fixture locks camelCase field names.".into(),
            due_on: Some("2026-07-25".into()),
            created_at: 1_720_000_001_000,
            updated_at: 1_720_000_002_000,
            completed_at: None,
            archived_at: None,
            links: WorkItemLinks {
                session_id: Some("sess_1".into()),
                knowledge: Some(WorkItemKnowledgeRef {
                    space_id: "space_a".into(),
                    doc_id: "doc_b".into(),
                }),
                url: Some("https://example.com".into()),
            },
        }
    }

    fn sample_catalog() -> WorkItemsCatalog {
        WorkItemsCatalog {
            version: 1,
            lists: vec![
                WorkItemList {
                    id: "wl_inbox".into(),
                    name: "Inbox".into(),
                    sort_order: 0,
                    created_at: 0,
                    updated_at: 0,
                    system: Some("inbox".into()),
                },
                WorkItemList {
                    id: "wl_work".into(),
                    name: "Work".into(),
                    sort_order: 1,
                    created_at: 1_720_000_000_000,
                    updated_at: 1_720_000_000_000,
                    system: None,
                },
            ],
            items: vec![sample_item()],
        }
    }

    #[test]
    fn missing_file_loads_default_inbox() {
        let p = std::env::temp_dir().join(format!(
            "hip-work-items-missing-{}-xyz.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        let cat = load_catalog(&p);
        assert_eq!(cat.version, 1);
        assert!(cat.items.is_empty());
        assert_eq!(cat.lists.len(), 1);
        assert_eq!(cat.lists[0].id, INBOX_LIST_ID);
        assert_eq!(cat.lists[0].system.as_deref(), Some("inbox"));
    }

    #[test]
    fn corrupt_file_backed_up_and_returns_default() {
        let p = tmp_path("corrupt");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        let cat = load_catalog(&p);
        assert_eq!(cat, default_catalog());
        assert!(!p.exists(), "corrupt original should be renamed away");
        let parent = p.parent().unwrap();
        let backups: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("catalog.json.corrupt-"))
            .collect();
        assert!(
            !backups.is_empty(),
            "expected catalog.json.corrupt-<ts> backup"
        );
    }

    #[test]
    fn save_load_roundtrip() {
        let p = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&p);
        let cat = sample_catalog();
        save_catalog(&p, &cat).unwrap();
        let loaded = load_catalog(&p);
        assert_eq!(loaded, cat);
    }

    #[test]
    #[cfg(unix)]
    fn file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        let _ = std::fs::remove_file(&p);
        save_catalog(&p, &default_catalog()).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn rejects_bad_version() {
        let mut cat = default_catalog();
        cat.version = 2;
        assert!(validate_catalog(&cat).is_err());
    }

    #[test]
    fn rejects_bad_item_id() {
        let mut cat = sample_catalog();
        cat.items[0].id = "task_1".into();
        assert!(validate_catalog(&cat).unwrap_err().contains("invalid item id"));
    }

    #[test]
    fn rejects_bad_list_id() {
        let mut cat = default_catalog();
        cat.lists.push(WorkItemList {
            id: "list_1".into(),
            name: "x".into(),
            sort_order: 1,
            created_at: 0,
            updated_at: 0,
            system: None,
        });
        assert!(validate_catalog(&cat).unwrap_err().contains("invalid list id"));
    }

    #[test]
    fn rejects_oversized_title_and_notes() {
        let mut cat = sample_catalog();
        cat.items[0].title = "x".repeat(TITLE_MAX + 1);
        assert!(validate_catalog(&cat).unwrap_err().contains("title too long"));

        cat = sample_catalog();
        cat.items[0].notes = "n".repeat(NOTES_MAX + 1);
        assert!(validate_catalog(&cat).unwrap_err().contains("notes too long"));
    }

    #[test]
    fn rejects_invalid_due_on() {
        let mut cat = sample_catalog();
        cat.items[0].due_on = Some("2026-02-31".into());
        assert!(validate_catalog(&cat).unwrap_err().contains("invalid dueOn"));
        cat.items[0].due_on = Some("not-a-date".into());
        assert!(validate_catalog(&cat).unwrap_err().contains("invalid dueOn"));
        cat.items[0].due_on = Some("2026-07-25T12:00:00Z".into());
        assert!(validate_catalog(&cat).unwrap_err().contains("invalid dueOn"));
    }

    #[test]
    fn accepts_null_due_on() {
        let mut cat = sample_catalog();
        cat.items[0].due_on = None;
        assert!(validate_catalog(&cat).is_ok());
    }

    #[test]
    fn is_valid_due_on_calendar() {
        assert!(is_valid_due_on("2026-07-25"));
        assert!(is_valid_due_on("2024-02-29")); // leap
        assert!(!is_valid_due_on("2025-02-29"));
        assert!(!is_valid_due_on("2026-13-01"));
        assert!(!is_valid_due_on("2026-00-10"));
        assert!(!is_valid_due_on("26-07-25"));
    }

    #[test]
    fn id_charset() {
        assert!(is_work_item_id("wi_abc"));
        assert!(is_work_item_id("wi_A1-_"));
        assert!(!is_work_item_id("wi_"));
        assert!(!is_work_item_id("wi_ab.c"));
        assert!(!is_work_item_id("wl_inbox"));
        assert!(is_work_list_id("wl_inbox"));
        assert!(is_work_list_id("wl_x"));
        assert!(!is_work_list_id("wi_x"));
    }

    #[test]
    fn golden_fixture_locks_camel_case_due_on() {
        let raw = include_str!("fixtures/work_items_catalog_golden.json");
        // Wire shape: camelCase field names (never dueAt).
        assert!(raw.contains("\"dueOn\""));
        assert!(!raw.contains("\"dueAt\""));
        assert!(raw.contains("\"listId\""));
        assert!(raw.contains("\"sortOrder\""));
        assert!(raw.contains("\"createdAt\""));
        assert!(raw.contains("\"completedAt\""));
        assert!(raw.contains("\"archivedAt\""));
        assert!(raw.contains("\"sessionId\""));
        assert!(raw.contains("\"spaceId\""));
        assert!(raw.contains("\"docId\""));

        let cat: WorkItemsCatalog = serde_json::from_str(raw).expect("golden deserializes");
        assert_eq!(cat.version, 1);
        assert_eq!(cat.items.len(), 1);
        assert_eq!(cat.items[0].due_on.as_deref(), Some("2026-07-25"));
        assert_eq!(cat.items[0].list_id, "wl_work");
        assert_eq!(
            cat.items[0]
                .links
                .knowledge
                .as_ref()
                .map(|k| (k.space_id.as_str(), k.doc_id.as_str())),
            Some(("space_a", "doc_b"))
        );

        // Round-trip serialization keeps camelCase keys.
        let v: serde_json::Value = serde_json::to_value(&cat).unwrap();
        assert_eq!(v["items"][0]["dueOn"], "2026-07-25");
        assert!(v["items"][0].get("dueAt").is_none());
        assert_eq!(v["items"][0]["listId"], "wl_work");
        assert_eq!(v["lists"][0]["sortOrder"], 0);
        assert_eq!(v["items"][0]["completedAt"], serde_json::Value::Null);
        assert_eq!(v["items"][0]["links"]["sessionId"], "sess_1");
        assert_eq!(v["items"][0]["links"]["knowledge"]["spaceId"], "space_a");

        validate_catalog(&cat).expect("golden catalog validates");
    }

    #[test]
    fn sample_matches_golden_shape() {
        let golden: WorkItemsCatalog =
            serde_json::from_str(include_str!("fixtures/work_items_catalog_golden.json")).unwrap();
        assert_eq!(sample_catalog(), golden);
    }
}
