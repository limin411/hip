//! Work-item UI prefs (`~/.hip/work-items/ui-prefs.json`) — status colors.
//! Missing or corrupt file → defaults (no corrupt backup required).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::atomic_write::atomic_write_private;
use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemUiPrefs {
    pub version: u32,
    pub status_colors: HashMap<String, String>,
}

fn default_colors() -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("todo".into(), "#3b82f6".into());
    m.insert("in_progress".into(), "#f59e0b".into());
    m.insert("done".into(), "#22c55e".into());
    m.insert("archived".into(), "#94a3b8".into());
    m
}

fn default_prefs() -> WorkItemUiPrefs {
    WorkItemUiPrefs {
        version: 1,
        status_colors: default_colors(),
    }
}

fn is_valid_hex(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 7 || b[0] != b'#' {
        return false;
    }
    b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

fn normalize_prefs(raw: WorkItemUiPrefs) -> WorkItemUiPrefs {
    let defaults = default_colors();
    let mut out = HashMap::new();
    for (k, def) in defaults {
        let v = raw
            .status_colors
            .get(&k)
            .map(|s| s.trim().to_string())
            .filter(|s| is_valid_hex(s))
            .unwrap_or(def);
        out.insert(k, v.to_lowercase());
    }
    WorkItemUiPrefs {
        version: 1,
        status_colors: out,
    }
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    paths::work_items_ui_prefs_path(app).ok_or_else(|| "work-items dir unavailable".into())
}

fn ensure_parent(path: &std::path::Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_prefs(path: &std::path::Path) -> WorkItemUiPrefs {
    match std::fs::read_to_string(path) {
        Ok(body) => match serde_json::from_str::<WorkItemUiPrefs>(&body) {
            Ok(p) => normalize_prefs(p),
            Err(_) => default_prefs(),
        },
        Err(_) => default_prefs(),
    }
}

#[tauri::command]
pub fn work_items_list_ui_prefs(app: AppHandle) -> Result<WorkItemUiPrefs, String> {
    let path = prefs_path(&app)?;
    Ok(read_prefs(&path))
}

#[tauri::command]
pub fn work_items_save_ui_prefs(app: AppHandle, prefs: WorkItemUiPrefs) -> Result<(), String> {
    let path = prefs_path(&app)?;
    ensure_parent(&path)?;
    let normalized = normalize_prefs(prefs);
    let body = serde_json::to_vec_pretty(&normalized).map_err(|e| e.to_string())?;
    atomic_write_private(&path, &body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_fills_defaults_and_lowercases() {
        let mut m = HashMap::new();
        m.insert("todo".into(), "#FF0000".into());
        m.insert("done".into(), "not-hex".into());
        let p = normalize_prefs(WorkItemUiPrefs {
            version: 9,
            status_colors: m,
        });
        assert_eq!(p.version, 1);
        assert_eq!(p.status_colors.get("todo").unwrap(), "#ff0000");
        assert_eq!(p.status_colors.get("done").unwrap(), "#22c55e");
        assert_eq!(p.status_colors.get("archived").unwrap(), "#94a3b8");
    }
}
