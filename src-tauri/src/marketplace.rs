//! Plugin marketplace catalog: seeded official sources + user-added GitHub sources.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::paths;
use crate::plugins;

// ── Seeded official sources (written on first install) ──────────────────────

pub const GROK_OFFICIAL: &str = "grok-official";
pub const CLAUDE_OFFICIAL: &str = "claude-official";

const GROK_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/xai-org/plugin-marketplace/main/.grok-plugin/marketplace.json";
const CLAUDE_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
const GROK_REPO: &str = "https://github.com/xai-org/plugin-marketplace";
const CLAUDE_REPO: &str = "https://github.com/anthropics/claude-plugins-official";

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarketInstallSpec {
    pub kind: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarketPluginEntry {
    pub key: String,
    pub market_source_id: String,
    pub market_kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    pub install: Option<MarketInstallSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_blocked_reason: Option<String>,
    pub download_state: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_plugin_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_review: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarketSourceState {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub description: String,
    pub catalog_repo: String,
    pub catalog_url: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_downloaded_plugins: Option<bool>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSnapshot {
    pub sources: Vec<MarketSourceState>,
    pub entries: Vec<MarketPluginEntry>,
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
    etag: Option<String>,
    #[serde(default)]
    builtin: Option<bool>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    catalog_repo: Option<String>,
    #[serde(default)]
    catalog_url: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone)]
struct ResolvedSource {
    id: String,
    kind: String,
    name: String,
    description: String,
    catalog_repo: String,
    catalog_url: String,
    enabled: bool,
    last_fetched_at: Option<String>,
    last_error: Option<String>,
    builtin: bool,
}

// ── Paths ───────────────────────────────────────────────────────────────────

pub fn marketplace_sources_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(paths::config_dir(app)?.join("marketplace-sources.json"))
}

pub fn marketplace_cache_dir(app: &tauri::AppHandle, source_id: &str) -> Option<PathBuf> {
    Some(paths::cache_dir(app)?.join("marketplaces").join(source_id))
}

fn seed_official(id: &str) -> Option<ResolvedSource> {
    match id {
        GROK_OFFICIAL => Some(ResolvedSource {
            id: GROK_OFFICIAL.to_string(),
            kind: "grok".into(),
            name: "Grok Official".into(),
            description: "Official xAI plugin marketplace for Grok Build".into(),
            catalog_repo: GROK_REPO.into(),
            catalog_url: GROK_CATALOG_URL.into(),
            enabled: true,
            last_fetched_at: None,
            last_error: None,
            builtin: true,
        }),
        CLAUDE_OFFICIAL => Some(ResolvedSource {
            id: CLAUDE_OFFICIAL.to_string(),
            kind: "claude".into(),
            name: "Claude Official".into(),
            description: "Official Anthropic directory of Claude Code plugins".into(),
            catalog_repo: CLAUDE_REPO.into(),
            catalog_url: CLAUDE_CATALOG_URL.into(),
            enabled: true,
            last_fetched_at: None,
            last_error: None,
            builtin: true,
        }),
        _ => None,
    }
}

fn seed_entry(id: &str) -> Option<SourceEntry> {
    let s = seed_official(id)?;
    Some(SourceEntry {
        enabled: true,
        last_fetched_at: None,
        last_error: None,
        etag: None,
        builtin: Some(true),
        kind: Some(s.kind),
        name: Some(s.name),
        description: Some(s.description),
        catalog_repo: Some(s.catalog_repo),
        catalog_url: Some(s.catalog_url),
    })
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
    m.insert("etag".into(), serde_json::json!(v.etag));
    if let Some(b) = v.builtin {
        m.insert("builtin".into(), serde_json::json!(b));
    }
    if let Some(ref k) = v.kind {
        m.insert("kind".into(), serde_json::json!(k));
    }
    if let Some(ref n) = v.name {
        m.insert("name".into(), serde_json::json!(n));
    }
    if let Some(ref d) = v.description {
        m.insert("description".into(), serde_json::json!(d));
    }
    if let Some(ref r) = v.catalog_repo {
        m.insert("catalogRepo".into(), serde_json::json!(r));
    }
    if let Some(ref u) = v.catalog_url {
        m.insert("catalogUrl".into(), serde_json::json!(u));
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
        "version": 2,
        "sources": serde_json::Value::Object(map),
    });
    let json = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

/// First install: create marketplace-sources.json with Grok + Claude official seeds.
/// Existing file is left alone (even if user deleted both sources).
pub fn ensure_sources_initialized(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let mut file = SourcesFile {
        version: 2,
        sources: HashMap::new(),
    };
    if let Some(e) = seed_entry(GROK_OFFICIAL) {
        file.sources.insert(GROK_OFFICIAL.to_string(), e);
    }
    if let Some(e) = seed_entry(CLAUDE_OFFICIAL) {
        file.sources.insert(CLAUDE_OFFICIAL.to_string(), e);
    }
    write_sources_file(path, &file)
}

fn resolve_entry(id: &str, entry: &SourceEntry) -> Option<ResolvedSource> {
    let has_full = entry.catalog_url.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
        && entry.catalog_repo.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
        && entry.kind.as_ref().map(|s| !s.is_empty()).unwrap_or(false);

    if has_full {
        let kind = entry.kind.clone().unwrap();
        if kind != "grok" && kind != "claude" {
            return None;
        }
        let builtin = entry.builtin.unwrap_or(false)
            || id == GROK_OFFICIAL
            || id == CLAUDE_OFFICIAL;
        return Some(ResolvedSource {
            id: id.to_string(),
            kind,
            name: entry
                .name
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| id.to_string()),
            description: entry.description.clone().unwrap_or_default(),
            catalog_repo: entry.catalog_repo.clone().unwrap(),
            catalog_url: entry.catalog_url.clone().unwrap(),
            enabled: entry.enabled,
            last_fetched_at: entry.last_fetched_at.clone(),
            last_error: entry.last_error.clone(),
            builtin,
        });
    }

    // Legacy v1 partial entries for official ids: fill from seed template.
    let mut seed = seed_official(id)?;
    seed.enabled = entry.enabled;
    seed.last_fetched_at = entry.last_fetched_at.clone();
    seed.last_error = entry.last_error.clone();
    Some(seed)
}

fn load_resolved_sources(app: &tauri::AppHandle) -> Result<Vec<ResolvedSource>, String> {
    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(&path)?;
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
    // Stable order: official seeds first, then others by id.
    out.sort_by(|a, b| {
        let rank = |id: &str| match id {
            GROK_OFFICIAL => 0,
            CLAUDE_OFFICIAL => 1,
            _ => 2,
        };
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
        .ok_or_else(|| format!("unknown marketplace source: {source_id}"))
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

// ── Downloaded-plugin check ─────────────────────────────────────────────────

fn has_downloaded_plugins(app: &tauri::AppHandle, source_id: &str) -> bool {
    let Some(plugins_root) = paths::plugins_dir(app) else {
        return false;
    };
    let config = paths::plugins_config_path(app);
    let installed = plugins::list_installed_plugins(&plugins_root, config.as_deref());
    installed
        .iter()
        .any(|m| m.market_source_id.as_deref() == Some(source_id))
}

// ── List sources ────────────────────────────────────────────────────────────

fn cache_meta_fetched_at(app: &tauri::AppHandle, source_id: &str) -> Option<String> {
    let (_, meta_path) = cache_paths(app, source_id).ok()?;
    let body = std::fs::read_to_string(meta_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v.get("fetchedAt")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

fn to_state(app: &tauri::AppHandle, src: &ResolvedSource) -> MarketSourceState {
    let count = load_cached_entries(app, src)
        .map(|e| e.len() as u32)
        .unwrap_or(0);
    let last_fetched_at = src
        .last_fetched_at
        .clone()
        .or_else(|| cache_meta_fetched_at(app, &src.id));
    MarketSourceState {
        id: src.id.clone(),
        kind: src.kind.clone(),
        name: src.name.clone(),
        description: src.description.clone(),
        catalog_repo: src.catalog_repo.clone(),
        catalog_url: src.catalog_url.clone(),
        enabled: src.enabled,
        last_fetched_at,
        last_error: src.last_error.clone(),
        plugin_count: if count > 0 { Some(count) } else { None },
        builtin: Some(src.builtin),
        has_downloaded_plugins: Some(has_downloaded_plugins(app, &src.id)),
    }
}

pub fn list_sources(app: &tauri::AppHandle) -> Result<Vec<MarketSourceState>, String> {
    let resolved = load_resolved_sources(app)?;
    Ok(resolved.iter().map(|s| to_state(app, s)).collect())
}

pub fn set_source_enabled(
    app: &tauri::AppHandle,
    source_id: &str,
    enabled: bool,
) -> Result<(), String> {
    if !is_safe_source_id(source_id) {
        return Err("invalid source id".into());
    }
    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(&path)?;
    let mut file = read_sources_file(&path);
    let mut entry = file
        .sources
        .get(source_id)
        .cloned()
        .ok_or_else(|| format!("unknown marketplace source: {source_id}"))?;
    // Ensure resolvable (upgrade legacy partial)
    let resolved = resolve_entry(source_id, &entry)
        .ok_or_else(|| format!("unknown marketplace source: {source_id}"))?;
    entry.enabled = enabled;
    // Persist full fields so custom/official stay complete
    entry.builtin = Some(resolved.builtin);
    entry.kind = Some(resolved.kind);
    entry.name = Some(resolved.name);
    entry.description = Some(resolved.description);
    entry.catalog_repo = Some(resolved.catalog_repo);
    entry.catalog_url = Some(resolved.catalog_url);
    file.sources.insert(source_id.to_string(), entry);
    file.version = 2;
    write_sources_file(&path, &file)
}

// ── Fetch / cache ───────────────────────────────────────────────────────────

fn cache_paths(app: &tauri::AppHandle, source_id: &str) -> Result<(PathBuf, PathBuf), String> {
    if !is_safe_source_id(source_id) {
        return Err("invalid source id".into());
    }
    let dir = marketplace_cache_dir(app, source_id).ok_or("no cache dir")?;
    Ok((dir.join("marketplace.json"), dir.join("meta.json")))
}

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
    let catalog_url = src.catalog_url.clone();

    // Only fetch registered catalog URLs (seeded or user-added).
    let registered: Vec<String> = load_resolved_sources(app)?
        .into_iter()
        .map(|s| s.catalog_url)
        .collect();
    if !registered.iter().any(|u| u == &catalog_url) {
        return Err("catalog URL not registered".into());
    }

    let body = fetch_catalog_body(&catalog_url).await?;
    validate_catalog_json(&body)?;
    let _ = normalize_catalog(source_id, &src.kind, &src.catalog_repo, &body)?;

    write_catalog_cache(app, source_id, &catalog_url, &body)?;
    update_source_fetched(app, source_id, None)?;
    Ok(())
}

async fn fetch_catalog_body(catalog_url: &str) -> Result<String, String> {
    if !catalog_url.starts_with("https://") {
        return Err("only https catalog urls allowed".into());
    }
    let resp = reqwest::get(catalog_url)
        .await
        .map_err(|e| format!("catalog fetch failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("catalog HTTP error: {e}"))?;
    resp.text()
        .await
        .map_err(|e| format!("catalog body read failed: {e}"))
}

fn validate_catalog_json(body: &str) -> Result<serde_json::Value, String> {
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid catalog json: {e}"))?;
    if !v.is_object() {
        return Err("catalog root must be a JSON object".into());
    }
    if v.get("plugins").and_then(|p| p.as_array()).is_none() {
        return Err("catalog missing plugins array".into());
    }
    Ok(v)
}

fn write_catalog_cache(
    app: &tauri::AppHandle,
    source_id: &str,
    catalog_url: &str,
    body: &str,
) -> Result<(), String> {
    let (json_path, meta_path) = cache_paths(app, source_id)?;
    if let Some(parent) = json_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = json_path.with_extension("tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &json_path).map_err(|e| e.to_string())?;

    let now = chrono_like_now();
    let meta = serde_json::json!({
        "fetchedAt": now,
        "sourceUrl": catalog_url,
    });
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
    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    let mut file = read_sources_file(&path);
    let mut entry = file
        .sources
        .get(source_id)
        .cloned()
        .ok_or_else(|| format!("unknown marketplace source: {source_id}"))?;
    if last_error.is_none() {
        entry.last_fetched_at = Some(chrono_like_now());
        entry.last_error = None;
    } else {
        entry.last_error = last_error;
    }
    file.sources.insert(source_id.to_string(), entry);
    file.version = 2;
    write_sources_file(&path, &file)
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn load_cached_body(app: &tauri::AppHandle, source_id: &str) -> Option<String> {
    let (json_path, _) = cache_paths(app, source_id).ok()?;
    std::fs::read_to_string(json_path).ok()
}

fn load_cached_entries(
    app: &tauri::AppHandle,
    src: &ResolvedSource,
) -> Option<Vec<MarketPluginEntry>> {
    let body = load_cached_body(app, &src.id)?;
    normalize_catalog(&src.id, &src.kind, &src.catalog_repo, &body).ok()
}

// ── Add / remove source ─────────────────────────────────────────────────────

/// Parse `https://github.com/owner/repo[.git]` → (owner, repo).
pub fn parse_github_https_repo(url: &str) -> Result<(String, String), String> {
    let t = url.trim();
    if t.is_empty() {
        return Err("git url is required".into());
    }
    if !t.starts_with("https://") {
        return Err("please use an https://github.com/owner/repo git url".into());
    }
    let rest = t
        .trim_start_matches("https://")
        .trim_start_matches("HTTPS://");
    let rest = rest
        .strip_prefix("github.com/")
        .or_else(|| rest.strip_prefix("www.github.com/"))
        .ok_or_else(|| "please use an https://github.com/owner/repo git url".to_string())?;
    let rest = rest.trim_matches('/');
    let mut parts = rest.split('/').filter(|p| !p.is_empty());
    let owner = parts
        .next()
        .ok_or_else(|| "please use an https://github.com/owner/repo git url".to_string())?;
    let mut repo = parts
        .next()
        .ok_or_else(|| "please use an https://github.com/owner/repo git url".to_string())?
        .to_string();
    if let Some(stripped) = repo.strip_suffix(".git") {
        repo = stripped.to_string();
    }
    // Reject extra path segments (tree/main, blob, etc.)
    if parts.next().is_some() {
        return Err("please use an https://github.com/owner/repo git url".into());
    }
    if owner.is_empty() || repo.is_empty() {
        return Err("please use an https://github.com/owner/repo git url".into());
    }
    if owner.contains("..") || repo.contains("..") {
        return Err("invalid repository path".into());
    }
    Ok((owner.to_string(), repo))
}

pub fn slug_source_id(owner: &str, repo: &str) -> String {
    let raw = format!("custom-{owner}-{repo}").to_lowercase();
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
        "custom-source".into()
    } else {
        out
    }
}

fn normalize_catalog_repo(owner: &str, repo: &str) -> String {
    format!("https://github.com/{owner}/{repo}")
}

/// Probe Grok / Claude marketplace.json under main then master.
async fn probe_github_catalog(
    owner: &str,
    repo: &str,
) -> Result<(String, String, String, String), String> {
    let paths_kinds = [
        (".grok-plugin/marketplace.json", "grok"),
        (".claude-plugin/marketplace.json", "claude"),
    ];
    let refs = ["main", "master"];
    let mut last_err = "marketplace catalog not found".to_string();

    for r#ref in refs {
        for (path, kind) in paths_kinds {
            let catalog_url = format!(
                "https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}"
            );
            match fetch_catalog_body(&catalog_url).await {
                Ok(body) => match validate_catalog_json(&body) {
                    Ok(v) => {
                        let name = v
                            .get("name")
                            .and_then(|x| x.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("{owner}/{repo}"));
                        let description = v
                            .get("description")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        return Ok((
                            kind.to_string(),
                            catalog_url,
                            name,
                            description,
                        ));
                    }
                    Err(e) => last_err = e,
                },
                Err(e) => last_err = e,
            }
        }
    }
    Err(format!(
        "could not find .grok-plugin or .claude-plugin marketplace.json: {last_err}"
    ))
}

pub async fn add_source(
    app: &tauri::AppHandle,
    git_url: &str,
) -> Result<MarketSourceState, String> {
    let (owner, repo) = parse_github_https_repo(git_url)?;
    let catalog_repo = normalize_catalog_repo(&owner, &repo);
    let source_id = slug_source_id(&owner, &repo);
    if !is_safe_source_id(&source_id) {
        return Err("could not derive a valid source id".into());
    }

    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(&path)?;
    let mut file = read_sources_file(&path);

    if file.sources.contains_key(&source_id) {
        return Err("this marketplace source already exists".into());
    }

    // Reject duplicate catalog repo / url against existing sources
    let existing = load_resolved_sources(app)?;
    for s in &existing {
        if normalize_repo_key(&s.catalog_repo) == normalize_repo_key(&catalog_repo) {
            return Err("this marketplace source already exists".into());
        }
    }

    let (kind, catalog_url, name, description) = probe_github_catalog(&owner, &repo).await?;

    // Also reject if catalog URL already registered
    if existing.iter().any(|s| s.catalog_url == catalog_url) {
        return Err("this marketplace source already exists".into());
    }

    let body = fetch_catalog_body(&catalog_url).await?;
    validate_catalog_json(&body)?;
    let _ = normalize_catalog(&source_id, &kind, &catalog_repo, &body)?;

    let now = chrono_like_now();
    let entry = SourceEntry {
        enabled: true,
        last_fetched_at: Some(now.clone()),
        last_error: None,
        etag: None,
        builtin: Some(false),
        kind: Some(kind.clone()),
        name: Some(name.clone()),
        description: Some(description.clone()),
        catalog_repo: Some(catalog_repo.clone()),
        catalog_url: Some(catalog_url.clone()),
    };
    file.sources.insert(source_id.clone(), entry);
    file.version = 2;
    write_sources_file(&path, &file)?;

    write_catalog_cache(app, &source_id, &catalog_url, &body)?;

    let resolved = ResolvedSource {
        id: source_id,
        kind,
        name,
        description,
        catalog_repo,
        catalog_url,
        enabled: true,
        last_fetched_at: Some(now),
        last_error: None,
        builtin: false,
    };
    Ok(to_state(app, &resolved))
}

fn normalize_repo_key(repo: &str) -> String {
    repo.trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_lowercase()
}

pub fn remove_source(app: &tauri::AppHandle, source_id: &str) -> Result<(), String> {
    if !is_safe_source_id(source_id) {
        return Err("invalid source id".into());
    }
    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    ensure_sources_initialized(&path)?;
    let mut file = read_sources_file(&path);
    if !file.sources.contains_key(source_id) {
        // Legacy: official only present via seed merge without full entry?
        // After init, official is in file. If missing → unknown.
        return Err(format!("unknown marketplace source: {source_id}"));
    }
    // Resolve to ensure it's a real source
    let entry = file.sources.get(source_id).cloned().unwrap();
    let _ = resolve_entry(source_id, &entry)
        .ok_or_else(|| format!("unknown marketplace source: {source_id}"))?;

    if has_downloaded_plugins(app, source_id) {
        return Err(
            "this marketplace source has downloaded plugins; uninstall them before removing the source"
                .into(),
        );
    }

    file.sources.remove(source_id);
    file.version = 2;
    write_sources_file(&path, &file)?;

    if let Some(dir) = marketplace_cache_dir(app, source_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}

// ── Normalize ───────────────────────────────────────────────────────────────

pub fn normalize_catalog(
    source_id: &str,
    kind: &str,
    catalog_repo: &str,
    body: &str,
) -> Result<Vec<MarketPluginEntry>, String> {
    let root: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid catalog: {e}"))?;
    let plugins = root
        .get("plugins")
        .and_then(|p| p.as_array())
        .ok_or("missing plugins")?;

    let mut out = Vec::new();
    for p in plugins {
        let name = p
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = p
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let category = p
            .get("category")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let homepage = p
            .get("homepage")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let license = p
            .get("license")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let keywords = p.get("keywords").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
        });
        let author = p.get("author").and_then(|a| {
            if let Some(s) = a.as_str() {
                Some(s.to_string())
            } else {
                a.get("name")
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            }
        });

        let (install, blocked) = resolve_install(p.get("source"), catalog_repo);

        out.push(MarketPluginEntry {
            key: format!("{source_id}::{name}"),
            market_source_id: source_id.to_string(),
            market_kind: kind.to_string(),
            name,
            description,
            author,
            category,
            keywords,
            homepage,
            license,
            install,
            install_blocked_reason: blocked,
            download_state: "not_downloaded".into(),
            enabled: false,
            local_plugin_id: None,
            model_review: None,
        });
    }
    Ok(out)
}

fn resolve_install(
    source: Option<&serde_json::Value>,
    catalog_repo: &str,
) -> (Option<MarketInstallSpec>, Option<String>) {
    let Some(source) = source else {
        return (None, Some("missing source".into()));
    };

    if let Some(s) = source.as_str() {
        return resolve_relative(s, catalog_repo);
    }

    if !source.is_object() {
        return (None, Some("unsupported source shape".into()));
    }

    let src_type = source
        .get("source")
        .or_else(|| source.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if src_type == "local" {
        if let Some(path) = source.get("path").and_then(|v| v.as_str()) {
            return resolve_relative(path, catalog_repo);
        }
        return (None, Some("local source missing path".into()));
    }

    let url = source.get("url").and_then(|v| v.as_str());
    let path = source
        .get("path")
        .and_then(|v| v.as_str())
        .map(strip_dot_slash);
    let sha = source
        .get("sha")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let r#ref = source
        .get("ref")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(url) = url {
        if !url.starts_with("https://") {
            return (None, Some("only https git urls allowed".into()));
        }
        let git_url = url.to_string();
        return (
            Some(MarketInstallSpec {
                kind: "git".into(),
                url: git_url,
                sha,
                r#ref,
                subpath: path,
            }),
            None,
        );
    }

    if let Some(path) = source.get("path").and_then(|v| v.as_str()) {
        return resolve_relative(path, catalog_repo);
    }

    (None, Some("could not resolve install source".into()))
}

fn strip_dot_slash(p: &str) -> String {
    let t = p.trim();
    if let Some(rest) = t.strip_prefix("./") {
        rest.to_string()
    } else {
        t.trim_start_matches('/').to_string()
    }
}

fn resolve_relative(
    path: &str,
    catalog_repo: &str,
) -> (Option<MarketInstallSpec>, Option<String>) {
    let sub = strip_dot_slash(path);
    if sub.is_empty() || sub.contains("..") {
        return (None, Some("invalid relative path".into()));
    }
    let mut url = catalog_repo.trim_end_matches('/').to_string();
    if !url.ends_with(".git") {
        url.push_str(".git");
    }
    (
        Some(MarketInstallSpec {
            kind: "git".into(),
            url,
            sha: None,
            r#ref: Some("main".into()),
            subpath: Some(sub),
        }),
        None,
    )
}

// ── Snapshot ────────────────────────────────────────────────────────────────

pub fn list_marketplace_snapshot(app: &tauri::AppHandle) -> Result<MarketplaceSnapshot, String> {
    let sources = list_sources(app)?;
    let plugins_root = paths::plugins_dir(app).ok_or("no plugins dir")?;
    let config = paths::plugins_config_path(app);
    let installed = plugins::list_installed_plugins(&plugins_root, config.as_deref());

    let mut by_market: HashMap<(String, String), &plugins::PluginMeta> = HashMap::new();
    let mut by_id: HashMap<String, &plugins::PluginMeta> = HashMap::new();
    for m in &installed {
        by_id.insert(m.id.clone(), m);
        if let (Some(ms), Some(mn)) = (&m.market_source_id, &m.market_plugin_name) {
            by_market.insert((ms.clone(), mn.clone()), m);
        }
    }

    let resolved = load_resolved_sources(app)?;
    let mut entries = Vec::new();
    for src in &resolved {
        if !src.enabled {
            for m in &installed {
                if m.market_source_id.as_deref() == Some(src.id.as_str()) {
                    let name = m
                        .market_plugin_name
                        .clone()
                        .unwrap_or_else(|| m.id.clone());
                    entries.push(MarketPluginEntry {
                        key: format!("{}::{}", src.id, name),
                        market_source_id: src.id.clone(),
                        market_kind: src.kind.clone(),
                        name: m.name.clone(),
                        description: if m.description.is_empty() {
                            None
                        } else {
                            Some(m.description.clone())
                        },
                        author: m.author.clone(),
                        category: None,
                        keywords: m.keywords.clone(),
                        homepage: m.source_url.clone(),
                        license: m.license.clone(),
                        install: None,
                        install_blocked_reason: None,
                        download_state: "downloaded".into(),
                        enabled: m.enabled,
                        local_plugin_id: Some(m.id.clone()),
                        model_review: m.model_review.clone(),
                    });
                }
            }
            continue;
        }

        let mut catalog = load_cached_entries(app, src).unwrap_or_default();
        for e in &mut catalog {
            if let Some(local) = by_market
                .get(&(e.market_source_id.clone(), e.name.clone()))
                .copied()
                .or_else(|| {
                    let slug = plugins::slugify_plugin(&e.name);
                    by_id.get(&slug).copied()
                })
            {
                e.download_state = "downloaded".into();
                e.enabled = local.enabled;
                e.local_plugin_id = Some(local.id.clone());
                e.model_review = local.model_review.clone();
            }
            entries.push(e.clone());
        }
    }

    Ok(MarketplaceSnapshot { sources, entries })
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_grok_url_and_local() {
        let body = r#"{
          "name": "xai-official",
          "plugins": [
            {
              "name": "vercel",
              "description": "Vercel",
              "source": {
                "source": "url",
                "url": "https://github.com/vercel/vercel-plugin.git",
                "sha": "abc123"
              },
              "keywords": ["vercel"]
            },
            {
              "name": "neon",
              "source": { "type": "local", "path": "./external_plugins/neon" }
            }
          ]
        }"#;
        let entries =
            normalize_catalog(GROK_OFFICIAL, "grok", GROK_REPO, body).unwrap();
        assert_eq!(entries.len(), 2);
        let v = &entries[0];
        assert_eq!(v.name, "vercel");
        let inst = v.install.as_ref().unwrap();
        assert_eq!(inst.url, "https://github.com/vercel/vercel-plugin.git");
        assert_eq!(inst.sha.as_deref(), Some("abc123"));

        let n = &entries[1];
        let inst = n.install.as_ref().unwrap();
        assert!(inst.url.contains("xai-org/plugin-marketplace"));
        assert_eq!(inst.subpath.as_deref(), Some("external_plugins/neon"));
    }

    #[test]
    fn normalize_claude_git_subdir_and_relative() {
        let body = r#"{
          "name": "claude-plugins-official",
          "plugins": [
            {
              "name": "airtable",
              "author": { "name": "Airtable" },
              "source": {
                "source": "git-subdir",
                "url": "https://github.com/Airtable/skills.git",
                "path": "plugins/airtable",
                "ref": "main",
                "sha": "deadbeef"
              }
            },
            {
              "name": "code-review",
              "source": "./plugins/code-review"
            }
          ]
        }"#;
        let entries =
            normalize_catalog(CLAUDE_OFFICIAL, "claude", CLAUDE_REPO, body).unwrap();
        assert_eq!(entries.len(), 2);
        let a = &entries[0];
        assert_eq!(a.author.as_deref(), Some("Airtable"));
        let inst = a.install.as_ref().unwrap();
        assert_eq!(inst.subpath.as_deref(), Some("plugins/airtable"));
        assert_eq!(inst.sha.as_deref(), Some("deadbeef"));

        let c = &entries[1];
        let inst = c.install.as_ref().unwrap();
        assert!(inst.url.contains("anthropics/claude-plugins-official"));
        assert_eq!(inst.subpath.as_deref(), Some("plugins/code-review"));
    }

    #[test]
    fn rejects_non_https() {
        let body = r#"{
          "plugins": [{
            "name": "bad",
            "source": { "source": "url", "url": "http://evil.example/x.git" }
          }]
        }"#;
        let entries = normalize_catalog(GROK_OFFICIAL, "grok", GROK_REPO, body).unwrap();
        assert!(entries[0].install.is_none());
        assert!(entries[0].install_blocked_reason.is_some());
    }

    #[test]
    fn parse_github_urls() {
        let (o, r) = parse_github_https_repo("https://github.com/acme/plugins.git").unwrap();
        assert_eq!(o, "acme");
        assert_eq!(r, "plugins");
        let (o, r) = parse_github_https_repo("https://github.com/acme/plugins/").unwrap();
        assert_eq!(o, "acme");
        assert_eq!(r, "plugins");
        assert!(parse_github_https_repo("http://github.com/a/b").is_err());
        assert!(parse_github_https_repo("https://gitlab.com/a/b").is_err());
        assert!(parse_github_https_repo("git@github.com:a/b.git").is_err());
    }

    #[test]
    fn slug_source_id_basic() {
        assert_eq!(slug_source_id("Acme", "My_Plugins"), "custom-acme-my-plugins");
        assert_eq!(slug_source_id("xai-org", "plugin-marketplace"), "custom-xai-org-plugin-marketplace");
    }

    #[test]
    fn ensure_sources_initialized_seeds_once() {
        let dir = std::env::temp_dir().join(format!(
            "hip-mkt-seed-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("marketplace-sources.json");
        assert!(!path.exists());
        ensure_sources_initialized(&path).unwrap();
        assert!(path.exists());
        let file = read_sources_file(&path);
        assert!(file.sources.contains_key(GROK_OFFICIAL));
        assert!(file.sources.contains_key(CLAUDE_OFFICIAL));
        // Existing file (even empty) is not re-seeded after user cleared sources
        let empty = SourcesFile {
            version: 2,
            sources: HashMap::new(),
        };
        write_sources_file(&path, &empty).unwrap();
        ensure_sources_initialized(&path).unwrap();
        let file2 = read_sources_file(&path);
        assert!(file2.sources.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_legacy_partial_official() {
        let entry = SourceEntry {
            enabled: false,
            last_fetched_at: Some("123".into()),
            last_error: None,
            etag: None,
            builtin: None,
            kind: None,
            name: None,
            description: None,
            catalog_repo: None,
            catalog_url: None,
        };
        let r = resolve_entry(GROK_OFFICIAL, &entry).unwrap();
        assert!(!r.enabled);
        assert_eq!(r.catalog_url, GROK_CATALOG_URL);
        assert!(r.builtin);
    }

    #[test]
    fn normalize_custom_source_id() {
        let body = r#"{
          "plugins": [{
            "name": "tool",
            "source": "./plugins/tool"
          }]
        }"#;
        let entries = normalize_catalog(
            "custom-acme-plugins",
            "claude",
            "https://github.com/acme/plugins",
            body,
        )
        .unwrap();
        assert_eq!(entries[0].market_source_id, "custom-acme-plugins");
        assert_eq!(entries[0].market_kind, "claude");
        let inst = entries[0].install.as_ref().unwrap();
        assert!(inst.url.contains("acme/plugins"));
    }
}
