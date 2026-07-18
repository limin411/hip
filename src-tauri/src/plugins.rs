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

#[derive(Serialize, Debug, PartialEq)]
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
    /// Unique hook event names detected in the plugin hooks module/JSON (best-effort).
    pub hook_events: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_plugin_md: Option<bool>,
}

/// Scan `<root>/*/.plugin/plugin.json`, parse each to build a `PluginMeta`.
/// Skips `.staging-*` install temp dirs. Never panics; missing root → empty list.
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
        if let Some(name) = dir.file_name().and_then(|s| s.to_str()) {
            if name.starts_with(".staging-") || name.starts_with('.') {
                continue;
            }
        }
        if let Some(meta) = scan_one_plugin(&dir) {
            out.push(meta);
        }
    }
    out
}

/// Scan a single plugin directory. Returns `None` if missing/invalid manifest.
pub fn scan_one_plugin(dir: &Path) -> Option<PluginMeta> {
    if !dir.is_dir() {
        return None;
    }
    let manifest_path = dir.join(".plugin").join("plugin.json");
    let meta = parse_plugin_json(&manifest_path)?;
    let id = dir.file_name()?.to_str()?.to_string();
    let name = match meta.name {
        Some(ref n) if !n.trim().is_empty() => n.clone(),
        _ => return None,
    };
    let version = meta.version.clone().unwrap_or_default();
    let skills = extract_skill_ids(meta.skills.as_ref(), dir);
    let mcp_servers = extract_mcp_servers(meta.mcp_servers.as_ref(), dir);
    let agents = extract_component_ids(meta.agents.as_ref(), dir, "agents");
    let (hook_count, hook_events) = scan_hooks(meta.hooks.as_ref(), dir);

    let mut plugin = PluginMeta {
        id,
        name,
        version,
        description: meta.description.clone().unwrap_or_default(),
        dir: dir.to_string_lossy().into_owned(),
        skills,
        mcp_servers,
        agents,
        hook_count,
        hook_events,
        author: author_name_from_manifest(&meta),
        license: meta.license.clone(),
        keywords: meta.keywords.clone().filter(|k| !k.is_empty()),
        source_url: author_url_from_manifest(&meta),
        source_type: None,
        has_plugin_md: None,
    };

    merge_plugin_md(dir, &mut plugin);
    Some(plugin)
}

/// List plugins under `plugins_root`, then any paths registered in `hip-plugins.json`
/// that were not already discovered (external checkouts / e2e fixtures).
pub fn list_installed_plugins(plugins_root: &Path, config_path: Option<&Path>) -> Vec<PluginMeta> {
    let mut out = scan_plugins(plugins_root);
    let mut seen: std::collections::HashSet<String> = out
        .iter()
        .map(|m| std::fs::canonicalize(&m.dir).unwrap_or_else(|_| PathBuf::from(&m.dir)).to_string_lossy().into_owned())
        .collect();
    // Also key by id so we don't double-list.
    let mut seen_ids: std::collections::HashSet<String> = out.iter().map(|m| m.id.clone()).collect();

    if let Some(cfg) = config_path {
        let (paths, _) = read_plugins_config(cfg);
        for p in paths {
            let dir = PathBuf::from(&p);
            let canon = std::fs::canonicalize(&dir)
                .unwrap_or_else(|_| dir.clone())
                .to_string_lossy()
                .into_owned();
            if seen.contains(&canon) {
                continue;
            }
            if let Some(meta) = scan_one_plugin(&dir) {
                if seen_ids.contains(&meta.id) {
                    continue;
                }
                seen.insert(canon);
                seen_ids.insert(meta.id.clone());
                out.push(meta);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[derive(serde::Deserialize)]
struct RawManifest {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    license: Option<String>,
    keywords: Option<Vec<String>>,
    author: Option<serde_json::Value>,
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

fn author_name_from_manifest(meta: &RawManifest) -> Option<String> {
    let a = meta.author.as_ref()?;
    if let Some(s) = a.as_str() {
        let t = s.trim();
        return if t.is_empty() { None } else { Some(t.to_string()) };
    }
    a.get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn author_url_from_manifest(meta: &RawManifest) -> Option<String> {
    let a = meta.author.as_ref()?;
    a.get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Optional marketplace card: `PLUGIN.md` YAML frontmatter (same fence rules as SKILL.md).
#[derive(serde::Deserialize, Default)]
struct PluginMdFrontmatter {
    description: Option<String>,
    license: Option<String>,
    keywords: Option<Vec<String>>,
    author: Option<serde_yaml::Value>,
    source: Option<PluginMdSource>,
}

#[derive(serde::Deserialize, Default)]
struct PluginMdSource {
    #[serde(rename = "type")]
    source_type: Option<String>,
    url: Option<String>,
}

fn parse_plugin_md_frontmatter(body: &str) -> Option<PluginMdFrontmatter> {
    let rest = body
        .strip_prefix("---\n")
        .or_else(|| body.strip_prefix("---\r\n"))?;
    let end = rest
        .find("\n---")
        .map(|i| i + 1)
        .or_else(|| if rest.starts_with("---") { Some(0) } else { None })?;
    let yaml = &rest[..end];
    serde_yaml::from_str::<PluginMdFrontmatter>(yaml).ok()
}

fn author_name_from_yaml(v: &serde_yaml::Value) -> Option<String> {
    match v {
        serde_yaml::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        serde_yaml::Value::Mapping(map) => {
            let key = serde_yaml::Value::String("name".into());
            map.get(&key)
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        }
        _ => None,
    }
}

fn merge_plugin_md(dir: &Path, plugin: &mut PluginMeta) {
    let path = dir.join("PLUGIN.md");
    if !path.is_file() {
        return;
    }
    plugin.has_plugin_md = Some(true);
    let body = match std::fs::read_to_string(&path) {
        Ok(b) => b,
        Err(_) => return,
    };
    let fm = match parse_plugin_md_frontmatter(&body) {
        Some(f) => f,
        None => return,
    };
    if let Some(d) = fm.description {
        let t = d.trim();
        if !t.is_empty() {
            plugin.description = t.to_string();
        }
    }
    if let Some(lic) = fm.license {
        let t = lic.trim();
        if !t.is_empty() {
            plugin.license = Some(t.to_string());
        }
    }
    if let Some(kw) = fm.keywords {
        if !kw.is_empty() {
            plugin.keywords = Some(kw);
        }
    }
    if let Some(a) = fm.author.as_ref().and_then(author_name_from_yaml) {
        plugin.author = Some(a);
    }
    if let Some(src) = fm.source {
        if let Some(t) = src.source_type {
            let t = t.trim();
            if !t.is_empty() {
                plugin.source_type = Some(t.to_string());
            }
        }
        if let Some(u) = src.url {
            let u = u.trim();
            if !u.is_empty() {
                plugin.source_url = Some(u.to_string());
            }
        }
    }
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

/// Known lifecycle hook event names (keep in sync with `@hip/protocol` HookEvent).
const HOOK_EVENT_NAMES: &[&str] = &[
    "SessionStart",
    "TurnStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "TurnComplete",
    "Stop",
    "PermissionRequest",
    "ActivityStart",
    "ActivityEnd",
    "ActivityBudgetRequest",
];

/// Scan a `hooks` field: return `(entry_count, unique_event_names)`.
///
/// - Inline JSON array → length + `event` fields
/// - String path → JSON array if parseable; otherwise best-effort text scan of CJS/JS
/// - absent/unreadable → `(0, [])`
fn scan_hooks(value: Option<&serde_json::Value>, plugin_dir: &Path) -> (u32, Vec<String>) {
    let raw = match value {
        Some(v) => v,
        None => return (0, Vec::new()),
    };
    match raw {
        serde_json::Value::String(path_str) => {
            let resolved = match safe_resolve(path_str, plugin_dir) {
                Some(p) => p,
                None => return (0, Vec::new()),
            };
            if let Some(j) = read_json_file(&resolved) {
                if let Some(arr) = j.as_array() {
                    return (arr.len() as u32, events_from_json_array(arr));
                }
            }
            // CJS/JS modules are not JSON — scan source text for known event names.
            match std::fs::read_to_string(&resolved) {
                Ok(text) => {
                    let events = events_from_source_text(&text);
                    let count = count_event_assignments(&text).max(events.len() as u32);
                    (count, events)
                }
                Err(_) => (0, Vec::new()),
            }
        }
        serde_json::Value::Array(arr) => (arr.len() as u32, events_from_json_array(arr)),
        _ => (0, Vec::new()),
    }
}

fn events_from_json_array(arr: &[serde_json::Value]) -> Vec<String> {
    let mut out = Vec::new();
    for item in arr {
        if let Some(ev) = item.get("event").and_then(|v| v.as_str()) {
            if HOOK_EVENT_NAMES.contains(&ev) && !out.iter().any(|e| e == ev) {
                out.push(ev.to_string());
            }
        }
    }
    // Stable order: catalog order, not first-seen order.
    sort_hook_events(&mut out);
    out
}

/// Detect `event: "Name"` / `event: 'Name'` / `"event": "Name"` assignments in source.
fn events_from_source_text(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for name in HOOK_EVENT_NAMES {
        if source_mentions_hook_event(text, name) && !out.iter().any(|e| e == *name) {
            out.push((*name).to_string());
        }
    }
    sort_hook_events(&mut out);
    out
}

fn source_mentions_hook_event(text: &str, name: &str) -> bool {
    // Common CJS patterns: event: "PreToolUse", event: 'PreToolUse', "event": "PreToolUse"
    let patterns = [
        format!("event: \"{}\"", name),
        format!("event: '{}'", name),
        format!("event:\"{}\"", name),
        format!("event:'{}'", name),
        format!("\"event\": \"{}\"", name),
        format!("\"event\":\"{}\"", name),
        format!("'event': '{}'", name),
        format!("'event':'{}'", name),
    ];
    patterns.iter().any(|p| text.contains(p.as_str()))
}

/// Count how many times an `event: '…'` style assignment appears (for hookCount).
fn count_event_assignments(text: &str) -> u32 {
    let mut n = 0u32;
    for name in HOOK_EVENT_NAMES {
        let needles = [
            format!("event: \"{}\"", name),
            format!("event: '{}'", name),
            format!("event:\"{}\"", name),
            format!("event:'{}'", name),
            format!("\"event\": \"{}\"", name),
            format!("\"event\":\"{}\"", name),
        ];
        for needle in needles {
            let mut start = 0;
            while let Some(i) = text[start..].find(&needle) {
                n += 1;
                start += i + needle.len();
            }
        }
    }
    n
}

fn sort_hook_events(events: &mut Vec<String>) {
    events.sort_by_key(|e| {
        HOOK_EVENT_NAMES
            .iter()
            .position(|n| *n == e.as_str())
            .unwrap_or(usize::MAX)
    });
}

/// Back-compat helper for tests that only need the count.
#[cfg(test)]
fn count_hooks(value: Option<&serde_json::Value>, plugin_dir: &Path) -> u32 {
    scan_hooks(value, plugin_dir).0
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

fn read_plugins_config(config_path: &Path) -> (Vec<String>, Vec<serde_json::Value>) {
    let raw: serde_json::Value = match std::fs::read_to_string(config_path) {
        Ok(body) if !body.trim().is_empty() => serde_json::from_str(&body).unwrap_or_default(),
        _ => serde_json::Value::Null,
    };

    let mut plugins: Vec<String> = Vec::new();
    if let Some(arr) = raw.get("plugins").and_then(|v| v.as_array()) {
        for v in arr {
            if let Some(path) = v.as_str() {
                plugins.push(path.to_string());
            } else if let Some(obj) = v.as_object() {
                if let Some(dir) = obj.get("dir").and_then(|d| d.as_str()) {
                    plugins.push(dir.to_string());
                }
            }
        }
    }

    let entries: Vec<serde_json::Value> = raw
        .get("entries")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    (plugins, entries)
}

fn write_plugins_config(
    config_path: &Path,
    plugins: &[String],
    entries: &[serde_json::Value],
) -> Result<(), String> {
    let cfg = serde_json::json!({
        "plugins": plugins,
        "entries": entries,
    });
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path, json).map_err(|e| e.to_string())
}

/// Register an installed plugin directory so the sidecar can discover it.
pub fn register_plugin(config_path: &Path, plugin_dir: &Path) -> Result<(), String> {
    let dir_str = plugin_dir.to_string_lossy().into_owned();
    let (mut plugins, entries) = read_plugins_config(config_path);
    if !plugins.contains(&dir_str) {
        plugins.push(dir_str);
    }
    write_plugins_config(config_path, &plugins, &entries)
}

/// Remove a plugin directory from the registry by its slug/id.
pub fn unregister_plugin(config_path: &Path, plugin_id: &str) -> Result<(), String> {
    let (mut plugins, mut entries) = read_plugins_config(config_path);

    plugins.retain(|p| {
        Path::new(p)
            .file_name()
            .and_then(|s| s.to_str())
            .map(|name| name != plugin_id)
            .unwrap_or(true)
    });

    entries.retain(|e| {
        if let Some(obj) = e.as_object() {
            let id_matches = obj
                .get("id")
                .and_then(|v| v.as_str())
                .map(|id| id == plugin_id)
                .unwrap_or(false);
            let slug_matches = obj
                .get("slug")
                .and_then(|v| v.as_str())
                .map(|slug| slug == plugin_id)
                .unwrap_or(false);
            !id_matches && !slug_matches
        } else {
            true
        }
    });

    write_plugins_config(config_path, &plugins, &entries)
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
        assert_eq!(meta.hook_events, vec!["TurnStart", "TurnComplete"]);
        assert_eq!(meta.has_plugin_md, None);
    }

    #[test]
    fn plugin_md_enriches_marketplace_fields() {
        let tmp = TempDir::new();
        let plugin_dir = tmp.child("docs-plugin");
        fs::create_dir_all(plugin_dir.join(".plugin")).unwrap();
        tmp.write(
            "docs-plugin/.plugin/plugin.json",
            r#"{ "name": "Docs Plugin", "version": "0.2.0", "description": "from json", "skills": ["skills/hello"] }"#,
        );
        tmp.write(
            "docs-plugin/PLUGIN.md",
            r#"---
description: from plugin md
license: MIT
keywords: [git, review]
author:
  name: Alice
source:
  type: github
  url: https://github.com/org/docs-plugin
---

# Docs Plugin

Long body ignored for list scan.
"#,
        );
        let meta = scan_one_plugin(&plugin_dir).expect("plugin");
        assert_eq!(meta.description, "from plugin md");
        assert_eq!(meta.license.as_deref(), Some("MIT"));
        assert_eq!(meta.keywords.as_deref(), Some(&["git".to_string(), "review".to_string()][..]));
        assert_eq!(meta.author.as_deref(), Some("Alice"));
        assert_eq!(meta.source_type.as_deref(), Some("github"));
        assert_eq!(
            meta.source_url.as_deref(),
            Some("https://github.com/org/docs-plugin")
        );
        assert_eq!(meta.has_plugin_md, Some(true));
        assert_eq!(meta.skills, vec!["hello"]);
    }

    #[test]
    fn scan_plugins_skips_staging_dirs() {
        let tmp = TempDir::new();
        fs::create_dir_all(tmp.child(".staging-abc").join(".plugin")).unwrap();
        tmp.write(
            ".staging-abc/.plugin/plugin.json",
            r#"{ "name": "Staging", "version": "1.0.0" }"#,
        );
        fs::create_dir_all(tmp.child("real").join(".plugin")).unwrap();
        tmp.write(
            "real/.plugin/plugin.json",
            r#"{ "name": "Real", "version": "1.0.0" }"#,
        );
        let metas = scan_plugins(&tmp.path);
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].id, "real");
    }

    #[test]
    fn list_installed_includes_registry_external_path() {
        let tmp = TempDir::new();
        let plugins_root = tmp.child("plugins");
        fs::create_dir_all(&plugins_root).unwrap();
        let external = tmp.child("external-plugin");
        fs::create_dir_all(external.join(".plugin")).unwrap();
        tmp.write(
            "external-plugin/.plugin/plugin.json",
            r#"{ "name": "External", "version": "1.0.0", "skills": ["./skills/x"] }"#,
        );
        let config_path = tmp.child("hip-plugins.json");
        fs::write(
            &config_path,
            serde_json::json!({ "plugins": [external.to_string_lossy()] }).to_string(),
        )
        .unwrap();
        let metas = list_installed_plugins(&plugins_root, Some(&config_path));
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].id, "external-plugin");
        assert_eq!(metas[0].name, "External");
    }

    #[test]
    fn scan_hooks_from_cjs_source() {
        let tmp = TempDir::new();
        tmp.write(
            "hooks.cjs",
            r#"
module.exports = [
  { event: "PreToolUse", matcher: "run_script", handler: async () => ({ kind: "allow" }) },
  { event: 'PermissionRequest', handler: async () => ({ kind: "ask" }) },
]
"#,
        );
        let (count, events) = scan_hooks(Some(&json!("hooks.cjs")), &tmp.path);
        assert!(count >= 2);
        assert_eq!(events, vec!["PreToolUse", "PermissionRequest"]);
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
        assert!(meta.hook_events.is_empty());
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

    #[test]
    fn register_plugin_writes_path_string() {
        let tmp = TempDir::new();
        let config_path = tmp.child("hip-plugins.json");
        let plugin_dir = tmp.child("my-plugin");

        register_plugin(&config_path, &plugin_dir).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let plugins = cfg.get("plugins").unwrap().as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].as_str().unwrap(), plugin_dir.to_string_lossy());
    }

    #[test]
    fn register_plugin_dedupes_same_dir() {
        let tmp = TempDir::new();
        let config_path = tmp.child("hip-plugins.json");
        let plugin_dir = tmp.child("my-plugin");

        register_plugin(&config_path, &plugin_dir).unwrap();
        register_plugin(&config_path, &plugin_dir).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let plugins = cfg.get("plugins").unwrap().as_array().unwrap();
        assert_eq!(plugins.len(), 1);
    }

    #[test]
    fn register_plugin_preserves_sidecar_entries() {
        let tmp = TempDir::new();
        let config_path = tmp.child("hip-plugins.json");
        let plugin_dir = tmp.child("my-plugin");
        let entries = serde_json::json!({
            "plugins": [],
            "entries": [{ "slug": "existing", "name": "Existing" }],
        });
        fs::write(&config_path, serde_json::to_string(&entries).unwrap()).unwrap();

        register_plugin(&config_path, &plugin_dir).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let entries = cfg.get("entries").unwrap().as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("slug").unwrap().as_str().unwrap(), "existing");
    }

    #[test]
    fn register_plugin_migrates_legacy_manifest_objects() {
        let tmp = TempDir::new();
        let config_path = tmp.child("hip-plugins.json");
        let plugin_dir = tmp.child("my-plugin");
        let legacy = serde_json::json!({
            "plugins": [
                { "name": "Legacy Plugin", "dir": plugin_dir.to_string_lossy() }
            ],
        });
        fs::write(&config_path, serde_json::to_string(&legacy).unwrap()).unwrap();

        register_plugin(&config_path, &plugin_dir).unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let plugins = cfg.get("plugins").unwrap().as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].as_str().unwrap(), plugin_dir.to_string_lossy());
    }

    #[test]
    fn unregister_plugin_removes_path_by_slug() {
        let tmp = TempDir::new();
        let config_path = tmp.child("hip-plugins.json");
        let keep_dir = tmp.child("keep-plugin");
        let remove_dir = tmp.child("remove-plugin");

        register_plugin(&config_path, &keep_dir).unwrap();
        register_plugin(&config_path, &remove_dir).unwrap();
        unregister_plugin(&config_path, "remove-plugin").unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let plugins = cfg.get("plugins").unwrap().as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].as_str().unwrap(), keep_dir.to_string_lossy());
    }

    #[test]
    fn unregister_plugin_removes_sidecar_entries_by_slug() {
        let tmp = TempDir::new();
        let config_path = tmp.child("hip-plugins.json");
        fs::write(
            &config_path,
            serde_json::to_string(&serde_json::json!({
                "plugins": ["/path/remove-plugin"],
                "entries": [
                    { "slug": "remove-plugin", "name": "Remove" },
                    { "slug": "keep-plugin", "name": "Keep" },
                ],
            }))
            .unwrap(),
        )
        .unwrap();

        unregister_plugin(&config_path, "remove-plugin").unwrap();

        let raw = fs::read_to_string(&config_path).unwrap();
        let cfg: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let plugins = cfg.get("plugins").unwrap().as_array().unwrap();
        let entries = cfg.get("entries").unwrap().as_array().unwrap();
        assert!(plugins.is_empty());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].get("slug").unwrap().as_str().unwrap(), "keep-plugin");
    }
}
