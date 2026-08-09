//! Provider logo cache: download brand-mark SVGs from the models.dev logos CDN
//! into `~/.hip/cache/provider-logos/` and serve them back as data URLs.
//!
//! Offline/never-seen logos degrade gracefully: the command returns `None`
//! (renders letter fallback, or the renderer may retry the CDN directly).
//! Mirrors the catalog cache pattern (paths::cache_dir + tmp/rename write).

use crate::paths;
use std::path::{Path, PathBuf};

/// Default CDN base; mirrors `DEFAULT_MODELS_LOGO_BASE` in src/lib/providerLogo.ts.
const DEFAULT_LOGO_BASE: &str = "https://models.dev/logos";

/// Max accepted logo body — SVG brand marks are a few KB; guard against junk
/// responses (HTML error pages, decompressed bombs).
const MAX_LOGO_BYTES: usize = 512 * 1024;

/// Provider id → cache file name. Rejects traversal/path separators; the same
/// gate the frontend applies when building CDN URLs.
pub fn safe_logo_id(provider_id: &str) -> Option<&str> {
    let id = provider_id.trim();
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return None;
    }
    Some(id)
}

/// Absolute cache path `<cache>/provider-logos/<id>.svg`.
pub fn logo_cache_path(cache_dir: &Path, provider_id: &str) -> Option<PathBuf> {
    safe_logo_id(provider_id).map(|id| cache_dir.join("provider-logos").join(format!("{id}.svg")))
}

/// Host allowlist: models.dev, plus whatever `HIP_LOGO_BASE` points at
/// (mirrors / catalog's `HIP_MODELS_URL` override for tests and mirrors).
/// HTTPS only — never follow http:// redirects to arbitrary hosts.
fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let Some(host) = rest.split(['/', '?', '#']).next() else {
        return false;
    };
    if host.is_empty() {
        return false;
    }
    if host == "models.dev" {
        return true;
    }
    if let Ok(env) = std::env::var("HIP_LOGO_BASE") {
        if let Some(env_rest) = env.strip_prefix("https://") {
            if let Some(env_host) = env_rest.split(['/', '?', '#']).next() {
                if env_host == host {
                    return true;
                }
            }
        }
    }
    false
}

/// Download URL for a provider logo (env-overridable base, host allowlisted).
pub fn logo_download_url(provider_id: &str) -> Option<String> {
    safe_logo_id(provider_id)?;
    let base = std::env::var("HIP_LOGO_BASE").unwrap_or_else(|_| DEFAULT_LOGO_BASE.to_string());
    let url = format!("{}/{}.svg", base.trim_end_matches('/'), provider_id);
    host_allowed(&url).then_some(url)
}

/// Cheap content sanity check: non-empty, size-capped, starts with an `<svg`
/// tag (after whitespace) so HTML error pages never land in the cache.
fn validate_logo_body(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("empty logo body".into());
    }
    if bytes.len() > MAX_LOGO_BYTES {
        return Err(format!("logo body too large ({} bytes)", bytes.len()));
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
    if !head.trim_start().starts_with("<svg") {
        return Err("logo body is not svg".into());
    }
    Ok(())
}

/// Fetch and validate a logo body from an allowlisted https URL.
async fn download_logo(url: &str) -> Result<Vec<u8>, String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("logo fetch failed: {e}"))?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("logo body read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("logo HTTP {status}"));
    }
    validate_logo_body(&bytes)?;
    Ok(bytes.to_vec())
}

/// SVG bytes → `data:image/svg+xml;base64,...` (CSP already allows `data:` imgs).
pub fn logo_data_url(bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// Cached copy of a provider logo (data URL), downloading on first request.
/// Returns `Ok(None)` when the id is unsafe, no cache dir, offline, or the
/// download/validation failed — callers fall back to the CDN / letter mark.
#[tauri::command]
pub async fn provider_logo(
    app: tauri::AppHandle,
    provider_id: String,
) -> Result<Option<String>, String> {
    let Some(cache_dir) = paths::cache_dir(&app) else {
        return Ok(None);
    };
    let Some(path) = logo_cache_path(&cache_dir, &provider_id) else {
        return Ok(None);
    };
    // Cache hit (non-empty only — a 0-byte file is a miss and gets retried).
    if let Ok(bytes) = std::fs::read(&path) {
        if validate_logo_body(&bytes).is_ok() {
            return Ok(Some(logo_data_url(&bytes)));
        }
    }
    let Some(url) = logo_download_url(&provider_id) else {
        return Ok(None);
    };
    let bytes = match download_logo(&url).await {
        Ok(b) => b,
        Err(_) => return Ok(None), // offline / junk — letter fallback this round
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // tmp + rename so a half-written logo never becomes a "valid" cache entry.
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, &bytes).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
    Ok(Some(logo_data_url(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // HIP_LOGO_BASE is process-global; serialize the env-dependent tests so
    // parallel test threads cannot see each other's overrides.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn safe_id_rejects_traversal_and_separators() {
        assert_eq!(safe_logo_id("openai"), Some("openai"));
        assert_eq!(safe_logo_id("  groq  "), Some("groq"));
        assert_eq!(safe_logo_id(""), None);
        assert_eq!(safe_logo_id("a/b"), None);
        assert_eq!(safe_logo_id("a\\b"), None);
        assert_eq!(safe_logo_id("../x"), None);
        assert_eq!(safe_logo_id(".."), None);
    }

    #[test]
    fn cache_path_uses_safe_id() {
        let dir = Path::new("/tmp/hip-cache");
        assert_eq!(
            logo_cache_path(dir, "openai"),
            Some(PathBuf::from("/tmp/hip-cache/provider-logos/openai.svg"))
        );
        assert_eq!(logo_cache_path(dir, "a/b"), None);
    }

    #[test]
    fn download_url_allowlists_host() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("HIP_LOGO_BASE");
        assert_eq!(
            logo_download_url("openai"),
            Some("https://models.dev/logos/openai.svg".into())
        );
        // unsafe id → no url
        assert_eq!(logo_download_url("a/b"), None);
    }

    #[test]
    fn host_allowed_requires_https_models_dev() {
        assert!(host_allowed("https://models.dev/logos/openai.svg"));
        assert!(!host_allowed("http://models.dev/logos/openai.svg"));
        assert!(!host_allowed("https://evil.example/logos/openai.svg"));
        assert!(!host_allowed("https://models.dev.evil.example/logos/openai.svg"));
        assert!(!host_allowed("file:///etc/passwd"));
        assert!(!host_allowed(""));
    }

    #[test]
    fn host_allowed_honors_env_override() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("HIP_LOGO_BASE", "https://mirror.example/logos");
        assert!(host_allowed("https://mirror.example/logos/openai.svg"));
        // env host must still match exactly — not a superstring
        assert!(!host_allowed("https://mirror.example.evil/logos/openai.svg"));
        std::env::remove_var("HIP_LOGO_BASE");
    }

    #[test]
    fn validate_body_accepts_svg_and_rejects_junk() {
        assert!(validate_logo_body(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>").is_ok());
        assert!(validate_logo_body(b"  \n<svg></svg>").is_ok());
        assert!(validate_logo_body(b"").is_err());
        assert!(validate_logo_body(b"<!DOCTYPE html><html></html>").is_err());
        assert!(validate_logo_body(&vec![b'x'; MAX_LOGO_BYTES + 1]).is_err());
    }

    #[test]
    fn data_url_encodes_base64() {
        assert_eq!(
            logo_data_url(b"<svg/>"),
            "data:image/svg+xml;base64,PHN2Zy8+"
        );
    }
}
