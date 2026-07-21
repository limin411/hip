//! Official plugin marketplace catalog fetch, cache, and normalize.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::paths;
use crate::plugins;

// ── Built-in sources ────────────────────────────────────────────────────────

pub const GROK_OFFICIAL: &str = "grok-official";
pub const CLAUDE_OFFICIAL: &str = "claude-official";

const GROK_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/xai-org/plugin-marketplace/main/.grok-plugin/marketplace.json";
const CLAUDE_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
const GROK_REPO: &str = "https://github.com/xai-org/plugin-marketplace";
const CLAUDE_REPO: &str = "https://github.com/anthropics/claude-plugins-official";

fn allowed_catalog_urls() -> &'static [&'static str] {
    &[GROK_CATALOG_URL, CLAUDE_CATALOG_URL]
}

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
    sources: HashMap<String, SourceUserState>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct SourceUserState {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    last_fetched_at: Option<String>,
    #[serde(default)]
    last_error: Option<String>,
    #[serde(default)]
    etag: Option<String>,
}

fn default_true() -> bool {
    true
}

// ── Paths ───────────────────────────────────────────────────────────────────

pub fn marketplace_sources_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(paths::config_dir(app)?.join("marketplace-sources.json"))
}

pub fn marketplace_cache_dir(app: &tauri::AppHandle, source_id: &str) -> Option<PathBuf> {
    Some(paths::cache_dir(app)?.join("marketplaces").join(source_id))
}

fn builtin_meta(id: &str) -> Option<(&'static str, &'static str, &'static str, &'static str, &'static str)> {
    match id {
        GROK_OFFICIAL => Some((
            "grok",
            "Grok Official",
            "Official xAI plugin marketplace for Grok Build",
            GROK_REPO,
            GROK_CATALOG_URL,
        )),
        CLAUDE_OFFICIAL => Some((
            "claude",
            "Claude Official",
            "Official Anthropic directory of Claude Code plugins",
            CLAUDE_REPO,
            CLAUDE_CATALOG_URL,
        )),
        _ => None,
    }
}

fn all_source_ids() -> [&'static str; 2] {
    [GROK_OFFICIAL, CLAUDE_OFFICIAL]
}

// ── Config ──────────────────────────────────────────────────────────────────

fn read_sources_file(path: &Path) -> SourcesFile {
    match std::fs::read_to_string(path) {
        Ok(body) if !body.trim().is_empty() => {
            serde_json::from_str(&body).unwrap_or_default()
        }
        _ => SourcesFile::default(),
    }
}

fn write_sources_file(path: &Path, file: &SourcesFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut map = serde_json::Map::new();
    for (k, v) in &file.sources {
        map.insert(
            k.clone(),
            serde_json::json!({
                "enabled": v.enabled,
                "lastFetchedAt": v.last_fetched_at,
                "lastError": v.last_error,
                "etag": v.etag,
            }),
        );
    }
    let body = serde_json::json!({
        "version": 1,
        "sources": serde_json::Value::Object(map),
    });
    let json = serde_json::to_string_pretty(&body).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn user_state_for(file: &SourcesFile, id: &str) -> SourceUserState {
    file.sources.get(id).cloned().unwrap_or(SourceUserState {
        enabled: true,
        ..Default::default()
    })
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

pub fn list_sources(app: &tauri::AppHandle) -> Result<Vec<MarketSourceState>, String> {
    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    let file = read_sources_file(&path);
    let mut out = Vec::new();
    for id in all_source_ids() {
        let Some((kind, name, desc, repo, url)) = builtin_meta(id) else {
            continue;
        };
        let us = user_state_for(&file, id);
        let count = load_cached_entries(app, id)
            .map(|e| e.len() as u32)
            .unwrap_or(0);
        // Prefer sources file; fall back to cache meta so UI does not treat a warm cache as never-fetched.
        let last_fetched_at = us
            .last_fetched_at
            .clone()
            .or_else(|| cache_meta_fetched_at(app, id));
        out.push(MarketSourceState {
            id: id.to_string(),
            kind: kind.to_string(),
            name: name.to_string(),
            description: desc.to_string(),
            catalog_repo: repo.to_string(),
            catalog_url: url.to_string(),
            enabled: us.enabled,
            last_fetched_at,
            last_error: us.last_error,
            plugin_count: if count > 0 { Some(count) } else { None },
        });
    }
    Ok(out)
}

pub fn set_source_enabled(app: &tauri::AppHandle, source_id: &str, enabled: bool) -> Result<(), String> {
    if builtin_meta(source_id).is_none() {
        return Err(format!("unknown marketplace source: {source_id}"));
    }
    let path = marketplace_sources_path(app).ok_or("no config dir")?;
    let mut file = read_sources_file(&path);
    let mut st = user_state_for(&file, source_id);
    st.enabled = enabled;
    file.sources.insert(source_id.to_string(), st);
    file.version = 1;
    write_sources_file(&path, &file)
}

// ── Fetch / cache ───────────────────────────────────────────────────────────

fn cache_paths(app: &tauri::AppHandle, source_id: &str) -> Result<(PathBuf, PathBuf), String> {
    let dir = marketplace_cache_dir(app, source_id).ok_or("no cache dir")?;
    Ok((dir.join("marketplace.json"), dir.join("meta.json")))
}

pub async fn refresh_catalog(app: &tauri::AppHandle, source_id: Option<&str>) -> Result<(), String> {
    let ids: Vec<&str> = match source_id {
        Some(id) => {
            if builtin_meta(id).is_none() {
                return Err(format!("unknown marketplace source: {id}"));
            }
            vec![id]
        }
        None => all_source_ids().to_vec(),
    };
    let mut last_err: Option<String> = None;
    for id in ids {
        if let Err(e) = refresh_one(app, id).await {
            last_err = Some(e);
        }
    }
    if let Some(e) = last_err {
        // If all failed, surface; partial success still ok if at least one worked —
        // callers refresh one id typically.
        return Err(e);
    }
    Ok(())
}

async fn refresh_one(app: &tauri::AppHandle, source_id: &str) -> Result<(), String> {
    let (_kind, _name, _desc, _repo, catalog_url) =
        builtin_meta(source_id).ok_or_else(|| format!("unknown source {source_id}"))?;
    if !allowed_catalog_urls().contains(&catalog_url) {
        return Err("catalog URL not allowlisted".into());
    }

    let resp = reqwest::get(catalog_url)
        .await
        .map_err(|e| format!("catalog fetch failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("catalog HTTP error: {e}"))?;
    let body = resp
        .text()
        .await
        .map_err(|e| format!("catalog body read failed: {e}"))?;

    // Validate JSON + plugins array shape loosely
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("invalid catalog json: {e}"))?;
    if !v.is_object() {
        return Err("catalog root must be a JSON object".into());
    }
    if v.get("plugins").and_then(|p| p.as_array()).is_none() {
        return Err("catalog missing plugins array".into());
    }

    // Normalize once to ensure we can parse
    let _ = normalize_catalog(source_id, &body)?;

    let (json_path, meta_path) = cache_paths(app, source_id)?;
    if let Some(parent) = json_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = json_path.with_extension("tmp");
    std::fs::write(&tmp, &body).map_err(|e| e.to_string())?;
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

    // Update sources file
    let sp = marketplace_sources_path(app).ok_or("no config dir")?;
    let mut file = read_sources_file(&sp);
    let mut st = user_state_for(&file, source_id);
    st.last_fetched_at = Some(now);
    st.last_error = None;
    file.sources.insert(source_id.to_string(), st);
    file.version = 1;
    write_sources_file(&sp, &file)?;
    Ok(())
}

fn chrono_like_now() -> String {
    // RFC3339 without external chrono dep — use system time
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Approximate ISO; good enough for lastFetchedAt display
    format!("{secs}")
}

fn load_cached_body(app: &tauri::AppHandle, source_id: &str) -> Option<String> {
    let (json_path, _) = cache_paths(app, source_id).ok()?;
    std::fs::read_to_string(json_path).ok()
}

fn load_cached_entries(app: &tauri::AppHandle, source_id: &str) -> Option<Vec<MarketPluginEntry>> {
    let body = load_cached_body(app, source_id)?;
    normalize_catalog(source_id, &body).ok()
}

// ── Normalize ───────────────────────────────────────────────────────────────

pub fn normalize_catalog(source_id: &str, body: &str) -> Result<Vec<MarketPluginEntry>, String> {
    let (kind, _n, _d, catalog_repo, _url) =
        builtin_meta(source_id).ok_or_else(|| format!("unknown source {source_id}"))?;
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
        let author = p
            .get("author")
            .and_then(|a| {
                if let Some(s) = a.as_str() {
                    Some(s.to_string())
                } else {
                    a.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
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

    // String relative path: "./plugins/foo"
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

    // Grok local: { type: "local", path: "./external_plugins/x" }
    if src_type == "local" {
        if let Some(path) = source.get("path").and_then(|v| v.as_str()) {
            return resolve_relative(path, catalog_repo);
        }
        return (None, Some("local source missing path".into()));
    }

    // url / git-subdir
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
        let mut git_url = url.to_string();
        if !git_url.ends_with(".git") && git_url.contains("github.com") {
            // leave as-is; git accepts without .git
        }
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

    // path-only object without url — treat as relative to catalog
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

// ── Snapshot (list marketplace plugins) ─────────────────────────────────────

pub fn list_marketplace_snapshot(app: &tauri::AppHandle) -> Result<MarketplaceSnapshot, String> {
    let sources = list_sources(app)?;
    let plugins_root = paths::plugins_dir(app).ok_or("no plugins dir")?;
    let config = paths::plugins_config_path(app);
    let installed = plugins::list_installed_plugins(&plugins_root, config.as_deref());

    // Index installed by market provenance and by slug
    let mut by_market: HashMap<(String, String), &plugins::PluginMeta> = HashMap::new();
    let mut by_id: HashMap<String, &plugins::PluginMeta> = HashMap::new();
    for m in &installed {
        by_id.insert(m.id.clone(), m);
        if let (Some(ms), Some(mn)) = (&m.market_source_id, &m.market_plugin_name) {
            by_market.insert((ms.clone(), mn.clone()), m);
        }
    }

    let mut entries = Vec::new();
    for src in &sources {
        if !src.enabled {
            // Still include downloaded plugins for this source
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

        let mut catalog = load_cached_entries(app, &src.id).unwrap_or_default();
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
        let entries = normalize_catalog(GROK_OFFICIAL, body).unwrap();
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
        let entries = normalize_catalog(CLAUDE_OFFICIAL, body).unwrap();
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
        let entries = normalize_catalog(GROK_OFFICIAL, body).unwrap();
        assert!(entries[0].install.is_none());
        assert!(entries[0].install_blocked_reason.is_some());
    }
}
