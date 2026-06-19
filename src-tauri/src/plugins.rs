use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub dir: String,
}

/// Scan `<root>/*/.plugin/plugin.json`, parse each to build a `PluginMeta`.
/// Never panics; a missing/unreadable root yields an empty list.
pub fn scan_plugins(root: &Path) -> Vec<PluginMeta> {
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
        let manifest_path = dir.join(".plugin").join("plugin.json");
        let meta = match parse_plugin_json(&manifest_path) {
            Some(m) => m,
            None => continue,
        };
        let id = match dir.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let name = match meta.name {
            Some(n) if !n.trim().is_empty() => n,
            _ => continue,
        };
        let version = meta.version.unwrap_or_default();
        out.push(PluginMeta {
            id,
            name,
            version,
            description: meta.description.unwrap_or_default(),
            dir: dir.to_string_lossy().into_owned(),
        });
    }
    out
}

#[derive(serde::Deserialize)]
struct RawManifest {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
}

fn parse_plugin_json(path: &Path) -> Option<RawManifest> {
    let body = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<RawManifest>(&body).ok()
}

/// Find the directory that contains `.plugin/plugin.json`: either `dest` itself
/// or the single wrapping subfolder many archives add.
pub fn find_plugin_root(dest: &Path) -> Option<PathBuf> {
    if dest.join(".plugin").join("plugin.json").is_file() {
        return Some(dest.to_path_buf());
    }
    for entry in std::fs::read_dir(dest).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() && p.join(".plugin").join("plugin.json").is_file() {
            return Some(p);
        }
    }
    None
}

pub fn slugify_plugin(name: &str) -> String {
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
        "plugin".to_string()
    } else {
        out
    }
}

/// Read the current plugin config JSON, append a manifest, and write back.
/// Missing/corrupt config starts fresh with an empty array.
pub fn register_plugin(config_path: &Path, manifest: serde_json::Value) -> Result<(), String> {
    let mut plugins: Vec<serde_json::Value> = match std::fs::read_to_string(config_path) {
        Ok(raw) if !raw.trim().is_empty() => {
            serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v.get("plugins").cloned())
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default()
        }
        _ => Vec::new(),
    };
    plugins.push(manifest);
    let cfg = serde_json::json!({ "plugins": plugins });
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path, json).map_err(|e| e.to_string())
}

/// Remove a plugin from the config JSON by id.
pub fn unregister_plugin(config_path: &Path, plugin_id: &str) -> Result<(), String> {
    let plugins: Vec<serde_json::Value> = match std::fs::read_to_string(config_path) {
        Ok(raw) if !raw.trim().is_empty() => {
            serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v.get("plugins").cloned())
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default()
        }
        _ => return Ok(()),
    };
    let filtered: Vec<_> = plugins
        .into_iter()
        .filter(|v| {
            v.get("id")
                .and_then(|id| id.as_str())
                .map(|id| id != plugin_id)
                .unwrap_or(true)
        })
        .collect();
    let cfg = serde_json::json!({ "plugins": filtered });
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path, json).map_err(|e| e.to_string())
}
