use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_tools: Option<Vec<String>>,
    pub enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub dir: String,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<PluginMcpServerConfig>,
    pub agents: Vec<String>,
    pub hook_count: u32,
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
        let skills = extract_skill_ids(meta.skills.as_ref(), &dir);
        let mcp_servers = extract_mcp_servers(meta.mcp_servers.as_ref(), &dir);
        let agents = extract_component_ids(meta.agents.as_ref(), &dir, "agents");
        let hook_count = count_hooks(meta.hooks.as_ref(), &dir);
        out.push(PluginMeta {
            id,
            name,
            version,
            description: meta.description.unwrap_or_default(),
            dir: dir.to_string_lossy().into_owned(),
            skills,
            mcp_servers,
            agents,
            hook_count,
        });
    }
    out
}

#[derive(serde::Deserialize)]
struct RawManifest {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    #[serde(default)]
    skills: Option<serde_json::Value>,
    #[serde(default)]
    #[serde(rename = "mcpServers")]
    mcp_servers: Option<serde_json::Value>,
    #[serde(default)]
    agents: Option<serde_json::Value>,
    #[serde(default)]
    hooks: Option<serde_json::Value>,
}

fn parse_plugin_json(path: &Path) -> Option<RawManifest> {
    let body = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<RawManifest>(&body).ok()
}

// ── component extraction helpers ──────────────────────────────────────────────

/// Resolve a relative path against `plugin_dir`, rejecting `..` traversal.
/// Returns `None` if the value contains `..` or resolves outside `plugin_dir`.
/// Handles both existing and non-existing paths (canonicalizes parent for missing files).
fn safe_resolve(value: &str, plugin_dir: &Path) -> Option<PathBuf> {
    if value.contains("..") {
        return None;
    }
    let resolved = plugin_dir.join(value);

    // Canonicalize the plugin dir for prefix checking (handles macOS /var→/private/var etc.).
    let plugin_canonical =
        std::fs::canonicalize(plugin_dir).unwrap_or_else(|_| plugin_dir.to_path_buf());

    // Try canonicalizing the resolved path directly (requires it to exist).
    match std::fs::canonicalize(&resolved) {
        Ok(canonical) => {
            if canonical.starts_with(&plugin_canonical) {
                return Some(canonical);
            }
            None
        }
        Err(_) => {
            // File doesn't exist yet — canonicalize the nearest existing ancestor.
            let parent = resolved.parent()?;
            let filename = resolved.file_name()?;
            let parent_canonical =
                std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
            if parent_canonical.starts_with(&plugin_canonical) {
                Some(parent_canonical.join(filename))
            } else {
                None
            }
        }
    }
}

/// Read and parse a JSON file from a resolved path. Returns `None` on any failure.
fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let body = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&body).ok()
}

/// Extract skill IDs from a `skills` field.
///
/// - `"skills/my-skill"` (string path) → `["my-skill"]`
/// - `["skills/a", "skills/b"]` → `["a", "b"]`
/// - absent → `[]`
fn extract_skill_ids(value: Option<&serde_json::Value>, _plugin_dir: &Path) -> Vec<String> {
    let raw = match value {
        Some(v) => v,
        None => return Vec::new(),
    };
    let paths: Vec<&str> = match raw {
        serde_json::Value::String(s) => vec![s.as_str()],
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str())
            .collect(),
        _ => return Vec::new(),
    };
    paths
        .iter()
        .filter_map(|p| {
            // We don't need to resolve the file — just extract the last path segment as the ID.
            Path::new(p)
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .collect()
}

/// Extract component IDs from `mcpServers` / `agents` fields.
///
/// - String path → read JSON file, extract `id` from each entry in `wrapper_key` array or top-level array.
/// - Inline array → extract `id` from each config object.
/// - absent → `[]`
fn extract_component_ids(
    value: Option<&serde_json::Value>,
    plugin_dir: &Path,
    wrapper_key: &str,
) -> Vec<String> {
    let raw = match value {
        Some(v) => v,
        None => return Vec::new(),
    };
    let extract_ids = |entries: &[serde_json::Value]| -> Vec<String> {
        entries
            .iter()
            .filter_map(|v| {
                v.get("id")
                    .and_then(|id| id.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
            })
            .collect()
    };
    match raw {
        // String path: read the file and extract from it.
        serde_json::Value::String(path_str) => {
            let resolved = match safe_resolve(path_str, plugin_dir) {
                Some(p) => p,
                None => return Vec::new(),
            };
            let file_json = match read_json_file(&resolved) {
                Some(j) => j,
                None => return Vec::new(),
            };
            // Try wrapper_key array first, then top-level array.
            if let Some(arr) = file_json.get(wrapper_key).and_then(|v| v.as_array()) {
                return extract_ids(arr);
            }
            if let Some(arr) = file_json.as_array() {
                return extract_ids(arr);
            }
            Vec::new()
        }
        // Inline array.
        serde_json::Value::Array(arr) => extract_ids(arr),
        _ => Vec::new(),
    }
}

/// Extract MCP server configs from `mcpServers`.
///
/// - String path → read JSON file, use `.servers` array or top-level array.
/// - Inline array → use as-is.
/// - absent → `[]`
///
/// Skips entries missing required fields (`id`, `name`, `transport`) or with duplicate ids
/// (first occurrence wins).
fn extract_mcp_servers(
    value: Option<&serde_json::Value>,
    plugin_dir: &Path,
) -> Vec<PluginMcpServerConfig> {
    let raw = match value {
        Some(v) => v,
        None => return Vec::new(),
    };
    let entries: Vec<serde_json::Value> = match raw {
        serde_json::Value::String(path_str) => {
            let resolved = match safe_resolve(path_str, plugin_dir) {
                Some(p) => p,
                None => return Vec::new(),
            };
            let file_json = match read_json_file(&resolved) {
                Some(j) => j,
                None => return Vec::new(),
            };
            if let Some(arr) = file_json.get("servers").and_then(|v| v.as_array()) {
                arr.clone()
            } else if let Some(arr) = file_json.as_array() {
                arr.clone()
            } else {
                return Vec::new();
            }
        }
        serde_json::Value::Array(arr) => arr.clone(),
        _ => return Vec::new(),
    };

    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter_map(parse_mcp_server_config)
        .filter(|cfg| !cfg.id.is_empty() && seen.insert(cfg.id.clone()))
        .collect()
}

fn parse_mcp_server_config(value: serde_json::Value) -> Option<PluginMcpServerConfig> {
    let obj = value.as_object()?;
    let id = obj.get("id")?.as_str()?.to_string();
    let name = obj.get("name")?.as_str()?.to_string();
    let transport = obj.get("transport")?.as_str()?.to_string();
    let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
    let command = obj.get("command").and_then(|v| v.as_str().map(String::from));
    let args = obj.get("args").and_then(|v| {
        v.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
    });
    let env = obj.get("env").cloned();
    let url = obj.get("url").and_then(|v| v.as_str().map(String::from));
    let headers = obj.get("headers").cloned();
    let enabled_tools = obj.get("enabledTools").and_then(|v| {
        v.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
    });
    let disabled_tools = obj.get("disabledTools").and_then(|v| {
        v.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
    });

    Some(PluginMcpServerConfig {
        id,
        name,
        transport,
        command,
        args,
        env,
        url,
        headers,
        enabled_tools,
        disabled_tools,
        enabled,
    })
}

/// Count hook entries from a `hooks` field.
///
/// - String path → read JSON file, count array length.
/// - Inline array → use its length.
/// - absent/unreadable → `0`
fn count_hooks(value: Option<&serde_json::Value>, plugin_dir: &Path) -> u32 {
    let raw = match value {
        Some(v) => v,
        None => return 0,
    };
    match raw {
        // String path: read the file and count.
        serde_json::Value::String(path_str) => {
            let resolved = match safe_resolve(path_str, plugin_dir) {
                Some(p) => p,
                None => return 0,
            };
            let file_json = match read_json_file(&resolved) {
                Some(j) => j,
                None => return 0,
            };
            match file_json.as_array() {
                Some(arr) => arr.len() as u32,
                None => 0,
            }
        }
        // Inline array: count directly.
        serde_json::Value::Array(arr) => arr.len() as u32,
        _ => 0,
    }
}

// ── public helpers ────────────────────────────────────────────────────────────

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

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::io::Write;

    /// Write a file in a temp dir. Returns the temp dir (TempDir guard).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("hip-test-{}-{}", std::process::id(), n));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir { path: dir }
        }

        fn child(&self, name: &str) -> PathBuf {
            self.path.join(name)
        }

        fn write(&self, rel: &str, content: &str) {
            let p = self.path.join(rel);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            let mut f = fs::File::create(&p).unwrap();
            f.write_all(content.as_bytes()).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    // ── extract_skill_ids ─────────────────────────────────────────────────

    #[test]
    fn skill_ids_from_string_path() {
        let tmp = TempDir::new();
        let ids = extract_skill_ids(Some(&json!("skills/my-skill")), &tmp.path);
        assert_eq!(ids, vec!["my-skill"]);
    }

    #[test]
    fn skill_ids_from_array_paths() {
        let tmp = TempDir::new();
        let ids = extract_skill_ids(
            Some(&json!(["skills/a", "skills/b", "deep/nested/c"])),
            &tmp.path,
        );
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn skill_ids_absent() {
        let tmp = TempDir::new();
        let ids = extract_skill_ids(None, &tmp.path);
        assert_eq!(ids, Vec::<String>::new());
    }

    // ── extract_component_ids ──────────────────────────────────────────────

    #[test]
    fn mcp_ids_from_inline_array() {
        let tmp = TempDir::new();
        let ids = extract_component_ids(
            Some(&json!([
                { "id": "server-a", "command": "npx" },
                { "id": "server-b", "command": "node" }
            ])),
            &tmp.path,
            "servers",
        );
        assert_eq!(ids, vec!["server-a", "server-b"]);
    }

    #[test]
    fn mcp_ids_from_path_with_wrapper_key() {
        let tmp = TempDir::new();
        tmp.write(
            ".mcp.json",
            r#"{
                "servers": [
                    { "id": "filesystem", "command": "npx" },
                    { "id": "github", "command": "npx" }
                ]
            }"#,
        );
        let ids = extract_component_ids(
            Some(&json!(".mcp.json")),
            &tmp.path,
            "servers",
        );
        assert_eq!(ids, vec!["filesystem", "github"]);
    }

    #[test]
    fn mcp_ids_from_path_with_top_level_array() {
        let tmp = TempDir::new();
        tmp.write(
            "servers.json",
            r#"[
                { "id": "a", "command": "npx" },
                { "id": "b", "command": "node" }
            ]"#,
        );
        let ids = extract_component_ids(
            Some(&json!("servers.json")),
            &tmp.path,
            "servers",
        );
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn mcp_ids_absent() {
        let tmp = TempDir::new();
        let ids = extract_component_ids(None, &tmp.path, "servers");
        assert_eq!(ids, Vec::<String>::new());
    }

    #[test]
    fn mcp_ids_path_not_found() {
        let tmp = TempDir::new();
        // No file written — should return empty.
        let ids = extract_component_ids(
            Some(&json!("nonexistent.json")),
            &tmp.path,
            "servers",
        );
        assert_eq!(ids, Vec::<String>::new());
    }

    #[test]
    fn mcp_ids_path_traversal_rejected() {
        let tmp = TempDir::new();
        let ids = extract_component_ids(
            Some(&json!("../secret.json")),
            &tmp.path,
            "servers",
        );
        assert_eq!(ids, Vec::<String>::new());
    }

    #[test]
    fn agent_ids_from_inline_array() {
        let tmp = TempDir::new();
        let ids = extract_component_ids(
            Some(&json!([
                { "id": "coder", "model": "gpt-4" },
                { "id": "reviewer", "model": "gpt-4" }
            ])),
            &tmp.path,
            "agents",
        );
        assert_eq!(ids, vec!["coder", "reviewer"]);
    }

    // ── extract_mcp_servers ────────────────────────────────────────────────

    #[test]
    fn mcp_configs_from_inline_array() {
        let tmp = TempDir::new();
        let configs = extract_mcp_servers(
            Some(
                &json!([
                    { "id": "server-a", "name": "Server A", "transport": "stdio", "command": "npx", "enabled": true },
                    { "id": "server-b", "name": "Server B", "transport": "sse", "url": "https://example.com/mcp", "enabled": false }
                ]),
            ),
            &tmp.path,
        );
        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].id, "server-a");
        assert_eq!(configs[0].command, Some("npx".to_string()));
        assert_eq!(configs[1].id, "server-b");
        assert_eq!(configs[1].url, Some("https://example.com/mcp".to_string()));
        assert!(!configs[1].enabled);
    }

    #[test]
    fn mcp_configs_from_path_with_wrapper_key() {
        let tmp = TempDir::new();
        tmp.write(
            ".mcp.json",
            r#"{
                "servers": [
                    { "id": "filesystem", "name": "Filesystem", "transport": "stdio", "command": "npx", "enabled": true },
                    { "id": "github", "name": "GitHub", "transport": "stdio", "command": "npx", "enabled": true }
                ]
            }"#,
        );
        let configs = extract_mcp_servers(Some(&json!(".mcp.json")), &tmp.path);
        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].id, "filesystem");
        assert_eq!(configs[1].id, "github");
    }

    #[test]
    fn mcp_configs_from_path_with_top_level_array() {
        let tmp = TempDir::new();
        tmp.write(
            "servers.json",
            r#"[
                { "id": "a", "name": "A", "transport": "stdio", "command": "npx", "enabled": true },
                { "id": "b", "name": "B", "transport": "stdio", "command": "node", "enabled": true }
            ]"#,
        );
        let configs = extract_mcp_servers(Some(&json!("servers.json")), &tmp.path);
        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].id, "a");
        assert_eq!(configs[1].id, "b");
    }

    #[test]
    fn mcp_configs_skips_invalid_entries() {
        let tmp = TempDir::new();
        let configs = extract_mcp_servers(
            Some(
                &json!([
                    { "id": "server-a", "name": "Server A", "transport": "stdio", "enabled": true },
                    { "id": "missing-name", "transport": "stdio", "enabled": true },
                    { "name": "Missing ID", "transport": "stdio", "enabled": true },
                    { "id": "", "name": "Empty ID", "transport": "stdio", "enabled": true }
                ]),
            ),
            &tmp.path,
        );
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].id, "server-a");
    }

    #[test]
    fn mcp_configs_dedupes_by_id_first_wins() {
        let tmp = TempDir::new();
        let configs = extract_mcp_servers(
            Some(
                &json!([
                    { "id": "dup", "name": "First", "transport": "stdio", "enabled": true },
                    { "id": "dup", "name": "Second", "transport": "sse", "enabled": true }
                ]),
            ),
            &tmp.path,
        );
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].name, "First");
    }

    #[test]
    fn mcp_configs_absent() {
        let tmp = TempDir::new();
        let configs = extract_mcp_servers(None, &tmp.path);
        assert!(configs.is_empty());
    }

    #[test]
    fn mcp_configs_path_not_found() {
        let tmp = TempDir::new();
        let configs = extract_mcp_servers(Some(&json!("nonexistent.json")), &tmp.path);
        assert!(configs.is_empty());
    }

    // ── count_hooks ───────────────────────────────────────────────────────

    #[test]
    fn hook_count_from_inline_array() {
        let tmp = TempDir::new();
        let count = count_hooks(
            Some(&json!([
                { "event": "TurnStart", "handler": "foo" },
                { "event": "TurnComplete", "handler": "bar" },
                { "event": "PreToolUse", "handler": "baz" }
            ])),
            &tmp.path,
        );
        assert_eq!(count, 3);
    }

    #[test]
    fn hook_count_from_path() {
        let tmp = TempDir::new();
        tmp.write(
            "hooks.json",
            r#"[
                { "event": "SessionStart" },
                { "event": "Stop" }
            ]"#,
        );
        let count = count_hooks(Some(&json!("hooks.json")), &tmp.path);
        assert_eq!(count, 2);
    }

    #[test]
    fn hook_count_absent() {
        let tmp = TempDir::new();
        let count = count_hooks(None, &tmp.path);
        assert_eq!(count, 0);
    }

    #[test]
    fn hook_count_path_not_found() {
        let tmp = TempDir::new();
        let count = count_hooks(Some(&json!("gone.json")), &tmp.path);
        assert_eq!(count, 0);
    }

    // ── scan_plugins integration ──────────────────────────────────────────

    #[test]
    fn scan_plugins_full_extraction() {
        let tmp = TempDir::new();
        let plugin_dir = tmp.child("my-plugin");
        fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();

        // Write plugin manifest with all component types.
        let manifest = json!({
            "name": "Test Plugin",
            "version": "1.0.0",
            "description": "A test plugin",
            "skills": ["skills/code-review", "skills/refactor"],
            "mcpServers": [
                { "id": "inline-mcp", "name": "inline-mcp", "transport": "echo", "command": "echo", "enabled": true }
            ],
            "hooks": [
                { "event": "TurnStart", "handler": "onStart" },
                { "event": "TurnComplete", "handler": "onComplete" }
            ]
        });
        let manifest_str = serde_json::to_string_pretty(&manifest).unwrap();
        tmp.write("my-plugin/.plugin/plugin.json", &manifest_str);

        // Write an external agents JSON file referenced by path.
        tmp.write(
            "my-plugin/agents.json",
            r#"{
                "agents": [
                    { "id": "coder", "model": "gpt-4" },
                    { "id": "reviewer", "model": "claude-3" }
                ]
            }"#,
        );

        // Write the manifest with agents as a path reference.
        let manifest_with_agents = json!({
            "name": "Test Plugin",
            "version": "1.0.0",
            "description": "A test plugin",
            "skills": ["skills/code-review", "skills/refactor"],
            "mcpServers": [
                { "id": "inline-mcp", "name": "inline-mcp", "transport": "echo", "command": "echo", "enabled": true }
            ],
            "agents": "agents.json",
            "hooks": [
                { "event": "TurnStart", "handler": "onStart" },
                { "event": "TurnComplete", "handler": "onComplete" }
            ]
        });
        let manifest_str2 = serde_json::to_string_pretty(&manifest_with_agents).unwrap();
        // Overwrite with the version that references agents.json
        let mut f = fs::File::create(plugin_dir.join(".plugin").join("plugin.json")).unwrap();
        f.write_all(manifest_str2.as_bytes()).unwrap();

        let metas = scan_plugins(&tmp.path);
        assert_eq!(metas.len(), 1);
        let meta = &metas[0];
        assert_eq!(meta.id, "my-plugin");
        assert_eq!(meta.name, "Test Plugin");
        assert_eq!(meta.version, "1.0.0");
        assert_eq!(meta.skills, vec!["code-review", "refactor"]);
        assert_eq!(meta.mcp_servers, vec![PluginMcpServerConfig {
            id: "inline-mcp".to_string(),
            name: "inline-mcp".to_string(),
            transport: "echo".to_string(),
            command: Some("echo".to_string()),
            args: None,
            env: None,
            url: None,
            headers: None,
            enabled_tools: None,
            disabled_tools: None,
            enabled: true,
        }]);
        assert_eq!(meta.agents, vec!["coder", "reviewer"]);
        assert_eq!(meta.hook_count, 2);
    }

    #[test]
    fn scan_plugins_missing_components_returns_empty() {
        let tmp = TempDir::new();
        let plugin_dir = tmp.child("bare-plugin");
        fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();
        let manifest = json!({
            "name": "Bare Plugin",
            "version": "0.1.0"
        });
        let s = serde_json::to_string_pretty(&manifest).unwrap();
        tmp.write("bare-plugin/.plugin/plugin.json", &s);

        let metas = scan_plugins(&tmp.path);
        assert_eq!(metas.len(), 1);
        let meta = &metas[0];
        assert_eq!(meta.skills.len(), 0);
        assert_eq!(meta.mcp_servers.len(), 0);
        assert_eq!(meta.agents.len(), 0);
        assert_eq!(meta.hook_count, 0);
    }

    #[test]
    fn scan_plugins_invalid_json_skipped() {
        let tmp = TempDir::new();
        let plugin_dir = tmp.child("bad-plugin");
        fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();
        tmp.write("bad-plugin/.plugin/plugin.json", "not valid json");

        let metas = scan_plugins(&tmp.path);
        assert_eq!(metas.len(), 0);
    }

    #[test]
    fn scan_plugins_empty_root() {
        let tmp = TempDir::new();
        let metas = scan_plugins(&tmp.path);
        assert_eq!(metas.len(), 0);
    }

    #[test]
    fn scan_plugins_missing_name_skipped() {
        let tmp = TempDir::new();
        let plugin_dir = tmp.child("no-name");
        fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();
        tmp.write(
            "no-name/.plugin/plugin.json",
            r#"{"version": "1.0", "skills": ["skills/a"]}"#,
        );

        let metas = scan_plugins(&tmp.path);
        // name is empty/missing → skipped
        assert_eq!(metas.len(), 0);
    }
}
