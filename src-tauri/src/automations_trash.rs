//! Automation recycle bin under `~/.hip/trash/automations/manifest.json`.
//! Soft-delete moves a full automation snapshot out of `automations/catalog.json`.

use crate::automations::{load_catalog, save_catalog, Automation, AutomationsCatalog};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationsTrashEntry {
    pub id: String,
    pub deleted_at: i64,
    pub automation: Automation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationsTrashManifest {
    pub version: u32,
    #[serde(default)]
    pub entries: Vec<AutomationsTrashEntry>,
}

/// List DTO for the product recycle-bin UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationsTrashListItem {
    pub id: String,
    pub automation_id: String,
    pub name: String,
    pub deleted_at: i64,
    pub enabled: bool,
    pub trigger_kind: String,
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
    crate::paths::trash_automations_dir(app)
        .ok_or_else(|| "trash automations root unavailable".to_string())
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::automations_catalog_path(app).ok_or_else(|| "no automations dir".to_string())
}

fn manifest_path(trash: &Path) -> PathBuf {
    trash.join("manifest.json")
}

fn empty_manifest() -> AutomationsTrashManifest {
    AutomationsTrashManifest {
        version: MANIFEST_VERSION,
        entries: vec![],
    }
}

fn load_manifest(trash: &Path) -> AutomationsTrashManifest {
    let path = manifest_path(trash);
    match std::fs::read_to_string(&path) {
        Ok(body) => match serde_json::from_str::<AutomationsTrashManifest>(&body) {
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

fn save_manifest(trash: &Path, m: &AutomationsTrashManifest) -> Result<(), String> {
    std::fs::create_dir_all(trash).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    let path = manifest_path(trash);
    crate::atomic_write::atomic_write_private(&path, body.as_bytes()).map_err(|e| e.to_string())
}

fn trigger_kind_label(a: &Automation) -> String {
    match &a.trigger {
        crate::automations::AutomationTrigger::Manual => "manual".into(),
        crate::automations::AutomationTrigger::Daily { .. } => "daily".into(),
        crate::automations::AutomationTrigger::Weekly { .. } => "weekly".into(),
    }
}

fn to_list_item(e: &AutomationsTrashEntry) -> AutomationsTrashListItem {
    AutomationsTrashListItem {
        id: e.id.clone(),
        automation_id: e.automation.id.clone(),
        name: if e.automation.name.trim().is_empty() {
            "Untitled".into()
        } else {
            e.automation.name.clone()
        },
        deleted_at: e.deleted_at,
        enabled: e.automation.enabled,
        trigger_kind: trigger_kind_label(&e.automation),
    }
}

fn names_equal(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn name_taken(name: &str, catalog: &AutomationsCatalog) -> bool {
    let n = name.trim();
    if n.is_empty() {
        return false;
    }
    catalog
        .automations
        .iter()
        .any(|a| names_equal(&a.name, n))
}

/// Prefer original name; on collision use " (restored)" / " (restored N)".
fn allocate_unique_name(desired: &str, catalog: &AutomationsCatalog) -> String {
    let base = desired.trim();
    let base = if base.is_empty() { "Untitled" } else { base };
    if !name_taken(base, catalog) {
        return base.to_string();
    }
    let restored = format!("{base} (restored)");
    if !name_taken(&restored, catalog) {
        return restored;
    }
    for n in 2..1000 {
        let candidate = format!("{base} (restored {n})");
        if !name_taken(&candidate, catalog) {
            return candidate;
        }
    }
    format!("{base} (restored {})", now_ms())
}

/// Soft-delete: remove automation from live catalog and quarantine a snapshot.
#[tauri::command]
pub fn automations_soft_delete(
    app: AppHandle,
    id: String,
) -> Result<AutomationsTrashListItem, String> {
    let cat_path = catalog_path(&app)?;
    let trash = trash_root(&app)?;
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;

    let mut catalog = load_catalog(&cat_path);
    let pos = catalog
        .automations
        .iter()
        .position(|a| a.id == id)
        .ok_or_else(|| format!("automation not found: {id}"))?;
    let automation = catalog.automations.remove(pos);
    save_catalog(&cat_path, &catalog)?;

    let entry = AutomationsTrashEntry {
        id: mint_entry_id(),
        deleted_at: now_ms(),
        automation,
    };
    let list_item = to_list_item(&entry);

    let mut manifest = load_manifest(&trash);
    manifest.entries.insert(0, entry);
    save_manifest(&trash, &manifest)?;

    Ok(list_item)
}

#[tauri::command]
pub fn automations_list_trash(app: AppHandle) -> Result<Vec<AutomationsTrashListItem>, String> {
    let trash = trash_root(&app)?;
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let mut entries = load_manifest(&trash).entries;
    entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(entries.iter().map(to_list_item).collect())
}

#[tauri::command]
pub fn automations_restore_trash_entry(
    app: AppHandle,
    entry_id: String,
) -> Result<Automation, String> {
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

    // Avoid id clash if item somehow still lives (or was recreated).
    if catalog
        .automations
        .iter()
        .any(|a| a.id == entry.automation.id)
    {
        return Err(format!(
            "automation already exists: {}",
            entry.automation.id
        ));
    }

    let mut automation = entry.automation;
    automation.name = allocate_unique_name(&automation.name, &catalog);
    automation.updated_at = now_ms();
    catalog.automations.insert(0, automation.clone());
    save_catalog(&cat_path, &catalog)?;
    save_manifest(&trash, &manifest)?;
    Ok(automation)
}

#[tauri::command]
pub fn automations_hard_delete_trash_entry(
    app: AppHandle,
    entry_id: String,
) -> Result<(), String> {
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
pub fn automations_empty_trash(app: AppHandle) -> Result<u32, String> {
    let trash = trash_root(&app)?;
    let mut manifest = load_manifest(&trash);
    let n = manifest.entries.len() as u32;
    manifest.entries.clear();
    save_manifest(&trash, &manifest)?;
    Ok(n)
}

/// Purge trash entries older than retention days (1–365, default 7).
#[tauri::command]
pub fn automations_purge_expired_trash(
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
    use crate::automations::AutomationTrigger;

    fn sample_auto(id: &str, name: &str) -> Automation {
        Automation {
            id: id.into(),
            name: name.into(),
            prompt: "do work".into(),
            enabled: true,
            trigger: AutomationTrigger::Manual,
            project_path: None,
            llm_provider: None,
            model: None,
            agent_id: None,
            effort: None,
            permission_mode: None,
            skill_ids: None,
            template_id: None,
            created_at: 1,
            updated_at: 1,
            last_run_at: None,
            last_status: None,
            last_error: None,
            last_session_id: None,
            next_run_at: None,
        }
    }

    #[test]
    fn manifest_round_trip() {
        let dir = std::env::temp_dir().join(format!(
            "hip-auto-trash-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let m = AutomationsTrashManifest {
            version: 1,
            entries: vec![AutomationsTrashEntry {
                id: "tentry_1".into(),
                deleted_at: 99,
                automation: sample_auto("auto_1", "Daily"),
            }],
        };
        save_manifest(&dir, &m).unwrap();
        let loaded = load_manifest(&dir);
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.entries[0].automation.id, "auto_1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn allocate_unique_name_avoids_collisions() {
        let catalog = AutomationsCatalog {
            version: 1,
            automations: vec![
                sample_auto("auto_a", "Daily"),
                sample_auto("auto_b", "Daily (restored)"),
            ],
        };
        assert_eq!(
            allocate_unique_name("Daily", &catalog),
            "Daily (restored 2)"
        );
        assert_eq!(allocate_unique_name("Weekly", &catalog), "Weekly");
    }
}
