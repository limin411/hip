//! MCP Registry market sources: seeded official registry + user-added OpenAPI-compatible bases.
//! Catalog shape follows https://registry.modelcontextprotocol.io (GET /v0.1/servers).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::hip_config;
use crate::paths;

// ── Seeded official source ──────────────────────────────────────────────────

pub const MCP_OFFICIAL: &str = "mcp-official";
const MCP_OFFICIAL_URL: &str = "https://registry.modelcontextprotocol.io";
const MCP_OFFICIAL_NAME: &str = "MCP Official";
const MCP_OFFICIAL_DESC: &str = "Official Model Context Protocol server registry";

/// Seeded catalog entry so first paint works offline (GitHub official MCP).
const GITHUB_MCP_NAME: &str = "io.github.github/github-mcp-server";

// Cap pages so refresh stays bounded (100 per page × 20 = 2000 latest-ish servers).
// Full registry is larger; users can refresh again later. First paint must not hang forever.
const PAGE_LIMIT: u32 = 100;
const MAX_PAGES: u32 = 20;
const REQUEST_TIMEOUT_SECS: u64 = 45;

// ── Types (camelCase for FE) ────────────────────────────────────────────────

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySourceState {
    pub id: String,
    pub name: String,
    pub description: String,
    pub registry_url: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_installed_servers: Option<bool>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistryEntry {
    pub key: String,
    pub market_source_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub packages: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remotes: Option<serde_json::Value>,
    pub install_state: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_blocked_reason: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySnapshot {
    pub sources: Vec<McpRegistrySourceState>,
    pub entries: Vec<McpRegistryEntry>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SourcesFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    sources: HashMap<String, SourceEntry>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct SourceEntry {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    last_fetched_at: Option<String>,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    builtin: Option<bool>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    registry_url: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone)]
struct ResolvedSource {
    id: String,
    name: String,
    description: String,
    registry_url: String,
    enabled: bool,
    last_fetched_at: Option<String>,
    last_error: Option<String>,
    builtin: bool,
}

// ── Paths ───────────────────────────────────────────────────────────────────

pub fn mcp_registry_sources_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(paths::config_dir(app)?.join("mcp-registry-sources.json"))
}

pub fn mcp_registry_cache_dir(app: &tauri::AppHandle, source_id: &str) -> Option<PathBuf> {
    Some(paths::cache_dir(app)?.join("mcp-registries").join(source_id))
}

fn seed_official() -> ResolvedSource {
    ResolvedSource {
        id: MCP_OFFICIAL.to_string(),
        name: MCP_OFFICIAL_NAME.into(),
        description: MCP_OFFICIAL_DESC.into(),
        registry_url: MCP_OFFICIAL_URL.into(),
        enabled: true,
        last_fetched_at: None,
        last_error: None,
        builtin: true,
    }
}

fn seed_entry() -> SourceEntry {
    let s = seed_official();
    SourceEntry {
        enabled: true,
        last_fetched_at: None,
        last_error: None,
        builtin: Some(true),
        name: Some(s.name),
        description: Some(s.description),
        registry_url: Some(s.registry_url),
    }
}

// ── Config I/O ──────────────────────────────────────────────────────────────

fn read_sources_file(path: &Path) -> SourcesFile {
    match std::fs::read_to_string(path) {
        Ok(body) if !body.trim().is_empty() => {
            serde_json::from_str(&body).unwrap_or_default()
        }
        _ => SourcesFile::default(),
    }
}

fn entry_to_json(v: &SourceEntry) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    m.insert("enabled".into(), serde_json::json!(v.enabled));
    m.insert("lastFetchedAt".into(), serde_json::json!(v.last_fetched_at));
    m.insert("lastError".into(), serde_json::json!(v.last_error));
    if let Some(b) = v.builtin {
        m.insert("builtin".into(), serde_json::json!(b));
    }
    if let Some(ref n) = v.name {
        m.insert("name".into(), serde_json::json!(n));
    }
    if let Some(ref d) = v.description {
        m.insert("description".into(), serde_json::json!(d));
    }
    if let Some(ref u) = v.registry_url {
        m.insert("registryUrl".into(), serde_json::json!(u));
    }
    serde_json::Value::Object(m)
}

fn write_sources_file(path: &Path, file: &SourcesFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut map = serde_json::Map::new();
    for (k, v) in &file.sources {
        map.insert(k.clone(), entry_to_json(v));
    }
    let body = serde_json::json!({
        "version": 1,
        "sources": serde_json::Value::Object(map),
    });
    let json = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// First install: create mcp-registry-sources.json with official seed + GitHub MCP cache.
pub fn ensure_sources_initialized(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if path.exists() {
        // Ensure GitHub seed cache exists even if sources already present.
        ensure_github_seed_cache(app);
        return Ok(());
    }
    let mut file = SourcesFile {
        version: 1,
        sources: HashMap::new(),
    };
    file.sources.insert(MCP_OFFICIAL.to_string(), seed_entry());
    write_sources_file(path, &file)?;
    ensure_github_seed_cache(app);
    Ok(())
}

fn ensure_github_seed_cache(app: &tauri::AppHandle) {
    let Some(dir) = mcp_registry_cache_dir(app, MCP_OFFICIAL) else {
        return;
    };
    let json_path = dir.join("servers.json");
    if json_path.exists() {
        // Migrate stuck installs: seed-only cache was previously marked as fully fetched.
        if is_seed_only_cache(app, MCP_OFFICIAL) {
            let _ = mark_cache_seeded(app, MCP_OFFICIAL, MCP_OFFICIAL_URL);
            let _ = clear_source_fetched(app, MCP_OFFICIAL);
        }
        return;
    }
    let seed = github_mcp_seed_body();
    // Offline first paint only — mark as seed so the UI auto-refreshes live catalog.
    let _ = write_catalog_cache(app, MCP_OFFICIAL, MCP_OFFICIAL_URL, &seed, true);
}

/// True when cache still only holds the offline GitHub MCP seed (never live-refreshed).
/// Content is authoritative: a full live catalog is never treated as seed even if meta is stale.
fn is_seed_only_cache(app: &tauri::AppHandle, source_id: &str) -> bool {
    let Some(body) = load_cached_body(app, source_id) else {
        return true;
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&body) else {
        return false;
    };
    let Some(arr) = root.as_array() else {
        return false;
    };
    if arr.len() != 1 {
        return false;
    }
    let name = arr[0]
        .pointer("/server/name")
        .or_else(|| arr[0].get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    name == GITHUB_MCP_NAME
}

fn mark_cache_seeded(
    app: &tauri::AppHandle,
    source_id: &str,
    registry_url: &str,
) -> Result<(), String> {
    let (_, meta_path) = cache_paths(app, source_id)?;
    let meta = serde_json::json!({
        "fetchedAt": null,
        "sourceUrl": registry_url,
        "seeded": true,
    });
    std::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn clear_source_fetched(app: &tauri::AppHandle, source_id: &str) -> Result<(), String> {
    let path = mcp_registry_sources_path(app).ok_or("no config dir")?;
    let mut file = read_sources_file(&path);
    let Some(mut entry) = file.sources.get(source_id).cloned() else {
        return Ok(());
    };
    entry.last_fetched_at = None;
    // Keep last_error so UI can show prior failure if any; do not invent one.
    file.sources.insert(source_id.to_string(), entry);
    file.version = 1;
    write_sources_file(&path, &file)
}

fn github_mcp_seed_body() -> String {
    // Minimal official server.json for GitHub MCP (remote + oci). Updated on first refresh.
    serde_json::json!([
        {
            "server": {
                "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
                "name": GITHUB_MCP_NAME,
                "description": "Connect AI assistants to GitHub - manage repos, issues, PRs, and workflows through natural language.",
                "title": "GitHub",
                "repository": {
                    "url": "https://github.com/github/github-mcp-server",
                    "source": "github"
                },
                "version": "1.7.0",
                "packages": [
                    {
                        "registryType": "oci",
                        "identifier": "ghcr.io/github/github-mcp-server:1.7.0",
                        "transport": { "type": "stdio" },
                        "environmentVariables": [
                            {
                                "description": "Your GitHub personal access token with appropriate scopes.",
                                "isRequired": true,
                                "format": "string",
                                "isSecret": true,
                                "name": "GITHUB_PERSONAL_ACCESS_TOKEN"
                            }
                        ]
                    }
                ],
                "remotes": [
                    {
                        "type": "streamable-http",
                        "url": "https://api.githubcopilot.com/mcp/",
                        "headers": [
                            {
                                "description": "Authorization header with authentication token (PAT or App token)",
                                "isSecret": true,
                                "name": "Authorization"
                            }
                        ]
                    }
                ]
            },
            "_meta": {
                "io.modelcontextprotocol.registry/official": {
                    "status": "active",
                    "isLatest": true
                }
            }
        }
    ])
    .to_string()
}

fn resolve_entry(id: &str, entry: &SourceEntry) -> Option<ResolvedSource> {
    let url = entry.registry_url.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if id == MCP_OFFICIAL {
        let mut seed = seed_official();
        seed.enabled = entry.enabled;
        seed.last_fetched_at = entry.last_fetched_at.clone();
        seed.last_error = entry.last_error.clone();
        if let Some(u) = url {
            seed.registry_url = u;
        }
        if let Some(ref n) = entry.name {
            if !n.is_empty() {
                seed.name = n.clone();
            }
        }
        if let Some(ref d) = entry.description {
            seed.description = d.clone();
        }
        return Some(seed);
    }
    let registry_url = url?;
    if !registry_url.starts_with("https://") {
        return None;
    }
    Some(ResolvedSource {
        id: id.to_string(),
        name: entry
            .name
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.to_string()),
        description: entry.description.clone().unwrap_or_default(),
        registry_url,
        enabled: entry.enabled,
        last_fetched_at: entry.last_fetched_at.clone(),
        last_error: entry.last_error.clone(),
        builtin: entry.builtin.unwrap_or(false),
    })
}

fn is_safe_source_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn load_resolved_sources(app: &tauri::AppHandle) -> Result<Vec<ResolvedSource>, String> {
    let path = mcp_registry_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(app, &path)?;
    let file = read_sources_file(&path);
    let mut out: Vec<ResolvedSource> = Vec::new();
    for (id, entry) in &file.sources {
        if !is_safe_source_id(id) {
            continue;
        }
        if let Some(r) = resolve_entry(id, entry) {
            out.push(r);
        }
    }
    out.sort_by(|a, b| {
        let rank = |id: &str| if id == MCP_OFFICIAL { 0 } else { 1 };
        rank(&a.id)
            .cmp(&rank(&b.id))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

fn find_resolved(app: &tauri::AppHandle, source_id: &str) -> Result<ResolvedSource, String> {
    load_resolved_sources(app)?
        .into_iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("unknown MCP registry source: {source_id}"))
}

// ── Installed matching via hip.toml ─────────────────────────────────────────

#[derive(Clone)]
struct LocalMcpHit {
    id: String,
    enabled: bool,
    registry_name: String,
    registry_source_id: Option<String>,
}

fn list_local_mcp_hits(app: &tauri::AppHandle) -> Vec<LocalMcpHit> {
    let Ok(cfg) = hip_config::load_hip_config(app) else {
        return Vec::new();
    };
    cfg.mcp_servers
        .into_iter()
        .filter_map(|s| {
            let name = s.registry_name?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(LocalMcpHit {
                id: s.id,
                enabled: s.enabled,
                registry_name: name,
                registry_source_id: s.registry_source_id,
            })
        })
        .collect()
}

fn has_installed_for_source(hits: &[LocalMcpHit], source_id: &str) -> bool {
    hits.iter()
        .any(|h| h.registry_source_id.as_deref() == Some(source_id))
}

// ── List sources / snapshot ─────────────────────────────────────────────────

fn cache_paths(app: &tauri::AppHandle, source_id: &str) -> Result<(PathBuf, PathBuf), String> {
    if !is_safe_source_id(source_id) {
        return Err("invalid source id".into());
    }
    let dir = mcp_registry_cache_dir(app, source_id).ok_or("no cache dir")?;
    Ok((dir.join("servers.json"), dir.join("meta.json")))
}

fn cache_meta_fetched_at(app: &tauri::AppHandle, source_id: &str) -> Option<String> {
    let (_, meta_path) = cache_paths(app, source_id).ok()?;
    let body = std::fs::read_to_string(meta_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v.get("fetchedAt")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

fn load_cached_body(app: &tauri::AppHandle, source_id: &str) -> Option<String> {
    let (json_path, _) = cache_paths(app, source_id).ok()?;
    std::fs::read_to_string(json_path).ok()
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn write_catalog_cache(
    app: &tauri::AppHandle,
    source_id: &str,
    registry_url: &str,
    body: &str,
    seeded: bool,
) -> Result<(), String> {
    let (json_path, meta_path) = cache_paths(app, source_id)?;
    if let Some(parent) = json_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = json_path.with_extension("tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &json_path).map_err(|e| e.to_string())?;

    let now = chrono_like_now();
    let meta = if seeded {
        serde_json::json!({
            "fetchedAt": null,
            "sourceUrl": registry_url,
            "seeded": true,
        })
    } else {
        serde_json::json!({
            "fetchedAt": now,
            "sourceUrl": registry_url,
            "seeded": false,
            "count": serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|v| v.as_array().map(|a| a.len()))
                .unwrap_or(0),
        })
    };
    std::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn update_source_fetched(
    app: &tauri::AppHandle,
    source_id: &str,
    last_error: Option<String>,
) -> Result<(), String> {
    let path = mcp_registry_sources_path(app).ok_or("no config dir")?;
    let mut file = read_sources_file(&path);
    let mut entry = file
        .sources
        .get(source_id)
        .cloned()
        .ok_or_else(|| format!("unknown MCP registry source: {source_id}"))?;
    if last_error.is_none() {
        entry.last_fetched_at = Some(chrono_like_now());
        entry.last_error = None;
    } else {
        entry.last_error = last_error;
    }
    file.sources.insert(source_id.to_string(), entry);
    file.version = 1;
    write_sources_file(&path, &file)
}

fn normalize_cached(
    source_id: &str,
    body: &str,
    hits: &[LocalMcpHit],
) -> Result<Vec<McpRegistryEntry>, String> {
    let root: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid catalog: {e}"))?;
    let items = root
        .as_array()
        .ok_or("catalog root must be a JSON array of server list items")?;

    let mut out: Vec<McpRegistryEntry> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();

    for item in items {
        let server = item.get("server").unwrap_or(item);
        let name = server
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }

        let status = item
            .pointer("/_meta/io.modelcontextprotocol.registry/official/status")
            .and_then(|v| v.as_str())
            .or_else(|| {
                item.pointer("/_meta/io.modelcontextprotocol.registry/publisher-provided/status")
                    .and_then(|v| v.as_str())
            })
            .map(|s| s.to_string());

        if status.as_deref() == Some("deleted") {
            continue;
        }

        let is_latest = item
            .pointer("/_meta/io.modelcontextprotocol.registry/official/isLatest")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if !is_latest {
            // Prefer latest only when meta is present; keep if no meta.
            if item
                .pointer("/_meta/io.modelcontextprotocol.registry/official")
                .is_some()
            {
                continue;
            }
        }

        let title = server
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let description = server
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let version = server
            .get("version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let repository_url = server
            .pointer("/repository/url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let packages = server.get("packages").cloned();
        let remotes = server.get("remotes").cloned();

        let has_install_surface = packages
            .as_ref()
            .and_then(|p| p.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false)
            || remotes
                .as_ref()
                .and_then(|p| p.as_array())
                .map(|a| !a.is_empty())
                .unwrap_or(false);

        let install_blocked_reason = if !has_install_surface {
            Some("no packages or remotes in server.json".into())
        } else {
            None
        };

        let local = hits.iter().find(|h| {
            h.registry_name == name
                && (h.registry_source_id.as_deref() == Some(source_id)
                    || h.registry_source_id.is_none())
        });

        let key = format!("{source_id}::{name}");
        let entry = McpRegistryEntry {
            key: key.clone(),
            market_source_id: source_id.to_string(),
            name: name.clone(),
            title,
            description,
            version,
            repository_url,
            status,
            packages,
            remotes,
            install_state: if local.is_some() {
                "installed".into()
            } else {
                "not_installed".into()
            },
            enabled: local.map(|l| l.enabled).unwrap_or(false),
            local_server_id: local.map(|l| l.id.clone()),
            install_blocked_reason,
        };

        if let Some(&idx) = seen.get(&name) {
            // Prefer installed entry when replacing a not-installed one
            if out[idx].install_state != "installed" && entry.install_state == "installed" {
                out[idx] = entry;
            }
        } else {
            seen.insert(name, out.len());
            out.push(entry);
        }
    }

    // Installed first, then name
    out.sort_by(|a, b| {
        let rank = |e: &McpRegistryEntry| if e.install_state == "installed" { 0 } else { 1 };
        rank(a)
            .cmp(&rank(b))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

fn load_cached_entries(
    app: &tauri::AppHandle,
    src: &ResolvedSource,
    hits: &[LocalMcpHit],
) -> Option<Vec<McpRegistryEntry>> {
    let body = load_cached_body(app, &src.id)?;
    normalize_cached(&src.id, &body, hits).ok()
}

fn to_state(
    app: &tauri::AppHandle,
    src: &ResolvedSource,
    hits: &[LocalMcpHit],
) -> McpRegistrySourceState {
    let count = load_cached_entries(app, src, hits)
        .map(|e| e.len() as u32)
        .unwrap_or(0);
    let seed_only = is_seed_only_cache(app, &src.id);
    // Seed catalogs must look "never fetched" so the FE auto-refreshes the live registry.
    let last_fetched_at = if seed_only {
        None
    } else {
        src.last_fetched_at
            .clone()
            .or_else(|| cache_meta_fetched_at(app, &src.id))
    };
    McpRegistrySourceState {
        id: src.id.clone(),
        name: src.name.clone(),
        description: src.description.clone(),
        registry_url: src.registry_url.clone(),
        enabled: src.enabled,
        last_fetched_at,
        last_error: src.last_error.clone(),
        server_count: if count > 0 { Some(count) } else { None },
        builtin: Some(src.builtin),
        has_installed_servers: Some(has_installed_for_source(hits, &src.id)),
    }
}

pub fn list_sources(app: &tauri::AppHandle) -> Result<Vec<McpRegistrySourceState>, String> {
    let hits = list_local_mcp_hits(app);
    let resolved = load_resolved_sources(app)?;
    Ok(resolved.iter().map(|s| to_state(app, s, &hits)).collect())
}

pub fn list_snapshot(app: &tauri::AppHandle) -> Result<McpRegistrySnapshot, String> {
    let hits = list_local_mcp_hits(app);
    let resolved = load_resolved_sources(app)?;
    let sources: Vec<McpRegistrySourceState> = resolved
        .iter()
        .map(|s| to_state(app, s, &hits))
        .collect();
    let mut entries = Vec::new();
    for src in &resolved {
        if !src.enabled {
            // Still show installed from disabled sources
            if let Some(list) = load_cached_entries(app, src, &hits) {
                entries.extend(list.into_iter().filter(|e| e.install_state == "installed"));
            }
            continue;
        }
        if let Some(list) = load_cached_entries(app, src, &hits) {
            entries.extend(list);
        }
    }
    Ok(McpRegistrySnapshot { sources, entries })
}

pub fn set_source_enabled(
    app: &tauri::AppHandle,
    source_id: &str,
    enabled: bool,
) -> Result<(), String> {
    if !is_safe_source_id(source_id) {
        return Err("invalid source id".into());
    }
    let path = mcp_registry_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(app, &path)?;
    let mut file = read_sources_file(&path);
    let mut entry = file
        .sources
        .get(source_id)
        .cloned()
        .ok_or_else(|| format!("unknown MCP registry source: {source_id}"))?;
    let resolved = resolve_entry(source_id, &entry)
        .ok_or_else(|| format!("unknown MCP registry source: {source_id}"))?;
    entry.enabled = enabled;
    entry.builtin = Some(resolved.builtin);
    entry.name = Some(resolved.name);
    entry.description = Some(resolved.description);
    entry.registry_url = Some(resolved.registry_url);
    file.sources.insert(source_id.to_string(), entry);
    file.version = 1;
    write_sources_file(&path, &file)
}

// ── Fetch ───────────────────────────────────────────────────────────────────

pub async fn refresh_catalog(
    app: &tauri::AppHandle,
    source_id: Option<&str>,
) -> Result<(), String> {
    let ids: Vec<String> = match source_id {
        Some(id) => {
            let _ = find_resolved(app, id)?;
            vec![id.to_string()]
        }
        None => load_resolved_sources(app)?
            .into_iter()
            .map(|s| s.id)
            .collect(),
    };
    let mut last_err: Option<String> = None;
    for id in ids {
        if let Err(e) = refresh_one(app, &id).await {
            let _ = update_source_fetched(app, &id, Some(e.clone()));
            last_err = Some(e);
        }
    }
    if let Some(e) = last_err {
        return Err(e);
    }
    Ok(())
}

async fn refresh_one(app: &tauri::AppHandle, source_id: &str) -> Result<(), String> {
    let src = find_resolved(app, source_id)?;
    if !src.enabled {
        return Err("source is disabled".into());
    }
    let base = src.registry_url.trim_end_matches('/').to_string();
    if !base.starts_with("https://") {
        return Err("only https registry urls allowed".into());
    }

    let items = fetch_all_servers(&base).await?;
    let body = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    // Validate normalize
    let hits = list_local_mcp_hits(app);
    let normalized = normalize_cached(source_id, &body, &hits)?;
    if normalized.is_empty() {
        return Err("registry returned servers but none were usable".into());
    }

    write_catalog_cache(app, source_id, &base, &body, false)?;
    update_source_fetched(app, source_id, None)?;
    Ok(())
}

async fn fetch_all_servers(base: &str) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent("hip-mcp-registry/1.0")
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut cursor: Option<String> = None;
    // Do NOT pass version=latest on the list endpoint — that param belongs to
    // /servers/{name}/versions/{version}. List uses limit + cursor only.
    for page in 0..MAX_PAGES {
        let mut url = format!("{base}/v0.1/servers?limit={PAGE_LIMIT}");
        if let Some(ref c) = cursor {
            url.push_str("&cursor=");
            url.push_str(&urlencoding_encode(c));
        }
        let resp = client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| {
                format!(
                    "registry fetch failed (page {}): {e}. Check network access to {base}",
                    page + 1
                )
            })?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("registry body read failed (page {}): {e}", page + 1))?;
        if !status.is_success() {
            return Err(format!(
                "registry HTTP {} (page {}): {}",
                status.as_u16(),
                page + 1,
                text.chars().take(200).collect::<String>()
            ));
        }
        let body: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            format!(
                "registry json (page {}): {e}; body starts: {}",
                page + 1,
                text.chars().take(120).collect::<String>()
            )
        })?;

        let servers = body
            .get("servers")
            .and_then(|s| s.as_array())
            .ok_or_else(|| {
                format!(
                    "registry response missing servers array (page {}). keys={:?}",
                    page + 1,
                    body.as_object()
                        .map(|m| m.keys().cloned().collect::<Vec<_>>())
                        .unwrap_or_default()
                )
            })?;
        if servers.is_empty() && page == 0 {
            return Err("registry returned empty servers list".into());
        }
        for s in servers {
            out.push(s.clone());
        }

        let next = body
            .pointer("/metadata/nextCursor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty());
        if next.is_none() {
            break;
        }
        cursor = next;
    }
    if out.is_empty() {
        return Err("registry returned no servers".into());
    }
    Ok(out)
}

/// Minimal URL-encoding for cursor query values.
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ── Add / remove source ─────────────────────────────────────────────────────

fn slug_from_url(url: &str) -> String {
    let host = url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("registry");
    let raw = format!("custom-{host}").to_lowercase();
    let mut out = String::with_capacity(raw.len());
    let mut prev_dash = false;
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "custom-registry".into()
    } else {
        out
    }
}

fn normalize_base(url: &str) -> Result<String, String> {
    let t = url.trim().trim_end_matches('/').to_string();
    if t.is_empty() {
        return Err("registry url is required".into());
    }
    if !t.starts_with("https://") {
        return Err("please use an https:// registry base url".into());
    }
    Ok(t)
}

pub async fn add_source(
    app: &tauri::AppHandle,
    registry_url: &str,
) -> Result<McpRegistrySourceState, String> {
    let base = normalize_base(registry_url)?;
    let source_id = slug_from_url(&base);
    if !is_safe_source_id(&source_id) {
        return Err("could not derive a valid source id".into());
    }

    let path = mcp_registry_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(app, &path)?;
    let mut file = read_sources_file(&path);

    if file.sources.contains_key(&source_id) {
        return Err("this MCP registry source already exists".into());
    }

    let existing = load_resolved_sources(app)?;
    for s in &existing {
        if s.registry_url.trim_end_matches('/') == base {
            return Err("this MCP registry source already exists".into());
        }
    }

    // Probe API
    let items = fetch_all_servers(&base).await?;
    let body = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    let hits = list_local_mcp_hits(app);
    let _ = normalize_cached(&source_id, &body, &hits)?;

    let host = base
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("registry");
    let name = host.to_string();
    let description = format!("MCP Registry at {base}");
    let now = chrono_like_now();

    let entry = SourceEntry {
        enabled: true,
        last_fetched_at: Some(now.clone()),
        last_error: None,
        builtin: Some(false),
        name: Some(name.clone()),
        description: Some(description.clone()),
        registry_url: Some(base.clone()),
    };
    file.sources.insert(source_id.clone(), entry);
    file.version = 1;
    write_sources_file(&path, &file)?;
    write_catalog_cache(app, &source_id, &base, &body, false)?;

    let resolved = ResolvedSource {
        id: source_id,
        name,
        description,
        registry_url: base,
        enabled: true,
        last_fetched_at: Some(now),
        last_error: None,
        builtin: false,
    };
    Ok(to_state(app, &resolved, &hits))
}

pub fn remove_source(app: &tauri::AppHandle, source_id: &str) -> Result<(), String> {
    if !is_safe_source_id(source_id) {
        return Err("invalid source id".into());
    }
    let path = mcp_registry_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(app, &path)?;
    let mut file = read_sources_file(&path);
    if !file.sources.contains_key(source_id) {
        return Err(format!("unknown MCP registry source: {source_id}"));
    }
    let entry = file.sources.get(source_id).cloned().unwrap();
    let _ = resolve_entry(source_id, &entry)
        .ok_or_else(|| format!("unknown MCP registry source: {source_id}"))?;

    let hits = list_local_mcp_hits(app);
    if has_installed_for_source(&hits, source_id) {
        return Err(
            "this registry source has installed servers; remove them before removing the source"
                .into(),
        );
    }

    file.sources.remove(source_id);
    file.version = 1;
    write_sources_file(&path, &file)?;

    if let Some(dir) = mcp_registry_cache_dir(app, source_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}

// ── hip_config helpers need registry fields ─────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_github_seed() {
        let body = github_mcp_seed_body();
        let entries = normalize_cached(MCP_OFFICIAL, &body, &[]).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, GITHUB_MCP_NAME);
        assert_eq!(entries[0].title.as_deref(), Some("GitHub"));
        assert!(entries[0].remotes.is_some());
        assert_eq!(entries[0].install_state, "not_installed");
    }

    #[test]
    fn normalize_marks_installed() {
        let body = github_mcp_seed_body();
        let hits = vec![LocalMcpHit {
            id: "srv-1".into(),
            enabled: true,
            registry_name: GITHUB_MCP_NAME.into(),
            registry_source_id: Some(MCP_OFFICIAL.into()),
        }];
        let entries = normalize_cached(MCP_OFFICIAL, &body, &hits).unwrap();
        assert_eq!(entries[0].install_state, "installed");
        assert_eq!(entries[0].local_server_id.as_deref(), Some("srv-1"));
        assert!(entries[0].enabled);
    }

    #[test]
    fn slug_and_url_encode() {
        assert_eq!(
            slug_from_url("https://registry.example.com/v0"),
            "custom-registry-example-com"
        );
        assert_eq!(urlencoding_encode("a/b:1.0"), "a%2Fb%3A1.0");
    }

    #[test]
    fn normalize_base_rejects_http() {
        assert!(normalize_base("http://example.com").is_err());
        assert_eq!(
            normalize_base("https://example.com/").unwrap(),
            "https://example.com"
        );
    }
}
