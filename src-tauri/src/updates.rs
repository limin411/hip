//! Version check against GitHub Releases (Settings → General → Version & updates).
//!
//! v1 scope (see docs/design/app-update-settings/app-update-settings-spec.md):
//! check-only here — download / verify / open-installer live in later PRs.
//!
//! Layering rules (KD-13):
//! - `check_inner` is the pure check + cache write; it **never** emits events.
//! - `#[tauri::command] updates_check` only returns `check_inner(...)` — never emits.
//! - Only the (later) Rust wake loop may emit `updates://available`.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::hip_config::load_hip_config;
use crate::paths;

const LATEST_URL: &str = "https://api.github.com/repos/limin411/hip/releases/latest";
const CACHE_FILE: &str = "last-check.json";
const PARSER_VERSION: u32 = 1;

/// Check TTL for `force=false` reads: a successful result younger than this is
/// served straight from `last-check.json` without any network traffic.
const CHECK_TTL_SECS: i64 = 24 * 3600;

const CHECK_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CHECK_TOTAL_TIMEOUT: Duration = Duration::from_secs(20);

const ALLOWED_HOSTS: &[&str] = &[
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

// ── DTOs (camelCase JSON for the frontend) ──

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub version: String,
    pub debug_build: bool,
    pub os: String,
    pub arch: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateCheckStatus {
    UpToDate,
    UpdateAvailable,
    CurrentAhead,
    NoMatchingAsset,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAsset {
    pub name: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub browser_download_url: String,
    /// Lowercase hex from `assets[].digest` (`sha256:<hex>`). Missing ⇒ the UI
    /// must refuse to download.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub status: UpdateCheckStatus,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes_excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<UpdateAsset>,
    pub cache_hit: bool,
    pub checked_at: String,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_sec: Option<u64>,
    pub debug_build: bool,
}

// ── Cache (runtime state; NOT hip.toml) ──

/// `last-check.json` — written **only** on successful checks. `result` mirrors
/// `UpdateCheckResult` minus the runtime-only `debugBuild` / `cacheHit` fields.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct CachedResult {
    status: UpdateCheckStatus,
    current_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    latest_tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    latest_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    published_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    notes_excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    html_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    asset: Option<UpdateAsset>,
    checked_at: String,
    latency_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    retry_after_sec: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct LastCheckCache {
    parser_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
    checked_at: String,
    result: CachedResult,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prompted_tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prompted_at: Option<String>,
}

impl From<&UpdateCheckResult> for CachedResult {
    fn from(r: &UpdateCheckResult) -> Self {
        CachedResult {
            status: r.status.clone(),
            current_version: r.current_version.clone(),
            latest_tag: r.latest_tag.clone(),
            latest_version: r.latest_version.clone(),
            published_at: r.published_at.clone(),
            notes_excerpt: r.notes_excerpt.clone(),
            html_url: r.html_url.clone(),
            asset: r.asset.clone(),
            checked_at: r.checked_at.clone(),
            latency_ms: r.latency_ms,
            error_kind: r.error_kind.clone(),
            error_message: r.error_message.clone(),
            retry_after_sec: r.retry_after_sec,
        }
    }
}

impl CachedResult {
    fn into_result(self, cache_hit: bool) -> UpdateCheckResult {
        UpdateCheckResult {
            status: self.status,
            current_version: self.current_version,
            latest_tag: self.latest_tag,
            latest_version: self.latest_version,
            published_at: self.published_at,
            notes_excerpt: self.notes_excerpt,
            html_url: self.html_url,
            asset: self.asset,
            cache_hit,
            checked_at: self.checked_at,
            latency_ms: self.latency_ms,
            error_kind: self.error_kind,
            error_message: self.error_message,
            retry_after_sec: self.retry_after_sec,
            debug_build: false, // runtime-only; caller re-attaches
        }
    }
}

// ── Errors (mapped into UpdateCheckResult.status = Error) ──

#[derive(Debug, Clone, PartialEq, Eq)]
enum UpdateErrorKind {
    Network,
    RateLimit,
    Http,
    Parse,
    Host,
}

impl UpdateErrorKind {
    fn as_str(&self) -> &'static str {
        match self {
            UpdateErrorKind::Network => "network",
            UpdateErrorKind::RateLimit => "rate_limit",
            UpdateErrorKind::Http => "http",
            UpdateErrorKind::Parse => "parse",
            UpdateErrorKind::Host => "host",
        }
    }
}

#[derive(Debug, Clone)]
struct UpdateError {
    kind: UpdateErrorKind,
    message: String,
    retry_after_sec: Option<u64>,
}

impl UpdateError {
    fn new(kind: UpdateErrorKind, message: impl Into<String>) -> Self {
        UpdateError {
            kind,
            message: message.into(),
            retry_after_sec: None,
        }
    }
    fn host(msg: impl Into<String>) -> Self {
        UpdateError::new(UpdateErrorKind::Host, msg)
    }
    fn into_result(self, ctx: &CheckContext, latency_ms: u64) -> UpdateCheckResult {
        UpdateCheckResult {
            status: UpdateCheckStatus::Error,
            current_version: ctx.current_version.clone(),
            latest_tag: None,
            latest_version: None,
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: None,
            cache_hit: false,
            checked_at: now_iso8601(),
            latency_ms,
            error_kind: Some(self.kind.as_str().to_string()),
            error_message: Some(self.message),
            retry_after_sec: self.retry_after_sec,
            debug_build: false,
        }
    }
}

// ── GitHub API JSON ──

#[derive(Deserialize, Clone, Debug)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize, Clone, Debug)]
struct GithubAsset {
    name: String,
    size: u64,
    #[serde(default)]
    content_type: Option<String>,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

// ── Dev-session detection ──

/// `yarn tauri dev` ⇒ true (unless the tester opt-in env is set).
/// `yarn tauri build` / dogfood release ⇒ false.
pub fn dev_build() -> bool {
    cfg!(debug_assertions)
        && std::env::var("HIP_UPDATES_ALLOW_DEV_INSTALL").ok().as_deref() != Some("1")
}

// ── ISO-8601 (UTC) helpers — no chrono dep; we only ever read what we write ──

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_iso8601() -> String {
    format_iso8601(now_unix())
}

fn format_iso8601(unix: i64) -> String {
    let days = unix.div_euclid(86400);
    let rem = unix.rem_euclid(86400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Parse exactly `YYYY-MM-DDTHH:MM:SSZ` (our writer's format).
fn iso8601_to_unix(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[19] != b'Z' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let seg = s.get(r)?;
        if !seg.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        seg.parse().ok()
    };
    let y = num(0..4)?;
    let mo = num(5..7)?;
    let d = num(8..10)?;
    let h = num(11..13)?;
    let mi = num(14..16)?;
    let sec = num(17..19)?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    Some(days_from_civil(y, mo as u32, d as u32) * 86400 + h * 3600 + mi * 60 + sec)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Inverse of `civil_from_days`.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe as i64 - 719468
}

// ── Semver (pure; returns only Lt/Eq/Gt — never an "update" verdict) ──

fn parse_semver(s: &str) -> Result<([u64; 3], Option<String>), ()> {
    let s = s.trim();
    let s = s
        .strip_prefix('v')
        .or_else(|| s.strip_prefix('V'))
        .unwrap_or(s);
    // Drop build metadata.
    let s = s.split('+').next().unwrap_or(s);
    let (core, prerelease) = match s.split_once('-') {
        Some((c, p)) => (c, Some(p.to_string())),
        None => (s, None),
    };
    let mut out = [0u64; 3];
    for (i, part) in core.split('.').take(3).enumerate() {
        if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
            return Err(());
        }
        out[i] = part.parse().map_err(|_| ())?;
    }
    Ok((out, prerelease))
}

/// `a` vs `b`; invalid input ⇒ `Err(())` (callers report `error_parse`).
fn semver_cmp(a: &str, b: &str) -> Result<Ordering, ()> {
    let (a_core, a_pre) = parse_semver(a)?;
    let (b_core, b_pre) = parse_semver(b)?;
    for i in 0..3 {
        match a_core[i].cmp(&b_core[i]) {
            Ordering::Equal => continue,
            other => return Ok(other),
        }
    }
    Ok(match (a_pre.is_some(), b_pre.is_some()) {
        (true, false) => Ordering::Less,  // no prerelease wins
        (false, true) => Ordering::Greater,
        (true, true) => a_pre.cmp(&b_pre),
        (false, false) => Ordering::Equal,
    })
}

// ── Platform asset selection (KD-12 / KD-14) ──

/// Filename match rules per runtime. Windows aarch64 must NOT fall back to the
/// x64 NSIS (KD-14); Intel Mac must not receive the aarch64 dmg (KD-12).
fn select_asset(assets: &[GithubAsset], os: &str, arch: &str) -> Option<GithubAsset> {
    let predicate: fn(&str) -> bool = match (os, arch) {
        ("macos", "aarch64") => |n| n.contains("aarch64") && n.ends_with(".dmg"),
        ("macos", "x86_64") => |n| n.ends_with(".dmg") && (n.contains("x64") || n.contains("x86_64") || n.contains("intel")),
        ("windows", "x86_64") => |n| n.ends_with("x64-setup.exe"),
        ("windows", "aarch64") => |n| n.ends_with("arm64-setup.exe"),
        _ => |_| false,
    };
    assets
        .iter()
        .find(|a| predicate(&a.name.to_ascii_lowercase()))
        .cloned()
}

/// `assets[].digest` is `sha256:<hex>`. Only a 64-char lowercase hex is usable.
fn digest_sha256(a: &GithubAsset) -> Option<String> {
    let d = a.digest.as_deref()?;
    let hex = d.strip_prefix("sha256:")?.to_ascii_lowercase();
    if hex.len() == 64 && hex.bytes().all(|c| c.is_ascii_hexdigit()) {
        Some(hex)
    } else {
        None
    }
}

/// cmp = current vs latest. Mutually exclusive: never returns two statuses.
fn decide_status(
    cmp: Ordering,
    asset: Option<GithubAsset>,
) -> (UpdateCheckStatus, Option<UpdateAsset>) {
    match cmp {
        Ordering::Equal => (UpdateCheckStatus::UpToDate, None),
        Ordering::Greater => (UpdateCheckStatus::CurrentAhead, None),
        Ordering::Less => match asset {
            None => (UpdateCheckStatus::NoMatchingAsset, None),
            Some(a) => (
                UpdateCheckStatus::UpdateAvailable,
                Some(UpdateAsset {
                    sha256: digest_sha256(&a),
                    name: a.name,
                    size: a.size,
                    content_type: a.content_type,
                    browser_download_url: a.browser_download_url,
                }),
            ),
        },
    }
}

/// Truncate release notes to ~280 chars on a char boundary.
fn notes_excerpt(body: Option<&str>) -> Option<String> {
    let body = body?.trim();
    if body.is_empty() {
        return None;
    }
    if body.chars().count() <= 280 {
        return Some(body.to_string());
    }
    let mut out: String = body.chars().take(280).collect();
    out.push('…');
    Some(out)
}

// ── Host allowlist (SSRF / redirect guard) ──

fn assert_allowed(url: &reqwest::Url) -> Result<(), UpdateError> {
    if url.scheme() != "https" {
        return Err(UpdateError::host("update URL must be https"));
    }
    let host = url.host_str().unwrap_or("");
    if !ALLOWED_HOSTS.contains(&host) {
        // Log host only — never the full URL/query.
        crate::tauri_info!("updates", &format!("deny update host: {host}"));
        return Err(UpdateError::host("update host is not allowlisted"));
    }
    Ok(())
}

// ── Proxy-aware client builders ──

/// Extract **only** the `[proxy]` selection from voice's download client
/// (https → http → all, else env proxies). No timeouts here — the check and
/// download clients set their own.
pub(crate) fn proxy_client_builder(app: &AppHandle) -> Result<reqwest::ClientBuilder, String> {
    let mut builder = reqwest::Client::builder();
    if let Ok(cfg) = load_hip_config(app) {
        if let Some(proxy) = cfg.proxy {
            if proxy.enabled == Some(true) {
                let url = proxy
                    .https
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        proxy
                            .http
                            .as_deref()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                    })
                    .or_else(|| {
                        proxy
                            .all
                            .as_deref()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                    });
                if let Some(u) = url {
                    if let Ok(p) = reqwest::Proxy::all(u) {
                        builder = builder.proxy(p);
                    }
                }
            }
        }
    }
    Ok(builder)
}

fn user_agent(app: &AppHandle) -> String {
    format!(
        "hip/{ver} (+https://github.com/limin411/hip)",
        ver = app.package_info().version
    )
}

/// Check client: short budgets (a 20s total timeout must not balloon to voice's
/// 2h), UA, Accept header, and per-hop allowlist enforcement. Note: reqwest's
/// `Policy::custom` only runs on redirect attempts — the **original** URL is
/// validated separately in `check_inner`.
fn check_http_client(app: &AppHandle) -> Result<reqwest::Client, UpdateError> {
    let mut builder = proxy_client_builder(app)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, e))?;
    builder = builder
        .user_agent(user_agent(app))
        .connect_timeout(CHECK_CONNECT_TIMEOUT)
        .timeout(CHECK_TOTAL_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            match assert_allowed(attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(_) => attempt.error("host not allowlisted"),
            }
        }));
    builder
        .build()
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, e.to_string()))
}

// ── Cache I/O ──

fn cache_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join(CACHE_FILE)
}

/// `(raw_cache, result_usable)`. `parserVersion != 1` ⇒ treat as a cache miss
/// (no If-None-Match, no TTL shortcut, no 304 restore) so a parser fix can
/// never be locked to a stale structure.
fn read_cache(cache_dir: &Path) -> Option<(LastCheckCache, bool)> {
    let raw = std::fs::read_to_string(cache_path(cache_dir)).ok()?;
    let parsed: LastCheckCache = serde_json::from_str(&raw).ok()?;
    let usable = parsed.parser_version == PARSER_VERSION;
    Some((parsed, usable))
}

fn write_cache(cache_dir: &Path, cache: &LastCheckCache) {
    if let Ok(body) = serde_json::to_vec_pretty(cache) {
        if let Err(e) = crate::atomic_write::atomic_write_private(&cache_path(cache_dir), &body) {
            crate::tauri_info!("updates", &format!("cache write failed: {e}"));
        }
    }
}

// ── Core check (testable without an AppHandle) ──

struct CheckContext {
    current_version: String,
    cache_dir: PathBuf,
}

impl CheckContext {
    fn from_app(app: &AppHandle) -> Result<Self, UpdateError> {
        Ok(CheckContext {
            current_version: app.package_info().version.to_string(),
            cache_dir: paths::updates_cache_dir(app).ok_or_else(|| {
                UpdateError::new(UpdateErrorKind::Network, "no updates cache dir")
            })?,
        })
    }
}

async fn run_check(
    ctx: &CheckContext,
    force: bool,
    client: &reqwest::Client,
    url: &str,
) -> Result<UpdateCheckResult, UpdateError> {
    let start = Instant::now();
    let cache = read_cache(&ctx.cache_dir);

    // TTL shortcut (force=false only): fresh successful result → no network.
    if !force {
        if let Some((c, true)) = &cache {
            let checked = iso8601_to_unix(&c.checked_at).unwrap_or(0);
            if now_unix() - checked < CHECK_TTL_SECS {
                let mut out = c.result.clone().into_result(true);
                out.latency_ms = start.elapsed().as_millis() as u64;
                return Ok(out);
            }
        }
    }

    let mut req = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if !force {
        if let Some((c, true)) = &cache {
            if let Some(etag) = &c.etag {
                req = req.header(reqwest::header::IF_NONE_MATCH, etag);
            }
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, format!("network: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        // 304 is only meaningful when we have a usable cached result; otherwise
        // re-GET unconditionally (damaged cache must not stay locked to 304).
        if let Some((c, true)) = &cache {
            let mut out = c.result.clone().into_result(true);
            out.latency_ms = start.elapsed().as_millis() as u64;
            let mut updated = c.clone();
            updated.checked_at = out.checked_at.clone();
            write_cache(&ctx.cache_dir, &updated);
            crate::tauri_info!(
                "updates",
                &format!(
                    "check ok status={:?} cache_hit=true latency_ms={}",
                    out.status, out.latency_ms
                )
            );
            return Ok(out);
        }
        return Box::pin(run_check(ctx, true, client, url)).await;
    }

    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after = resp
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        if let Some(r) = resp.headers().get("x-ratelimit-remaining") {
            if let Ok(v) = r.to_str() {
                if let Ok(n) = v.trim().parse::<u64>() {
                    crate::tauri_info!("updates", &format!("429 ratelimit_remaining={n}"));
                }
            }
        }
        let mut err = UpdateError::new(
            UpdateErrorKind::RateLimit,
            format!("rate limited (HTTP {})", resp.status()),
        );
        err.retry_after_sec = retry_after;
        return Err(err); // never overwrite the successful cache
    }

    let status = resp.status();
    if !status.is_success() {
        return Err(UpdateError::new(
            UpdateErrorKind::Http,
            format!("HTTP {status}"),
        ));
    }

    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = resp
        .text()
        .await
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, format!("body: {e}")))?;
    let release: GithubRelease = serde_json::from_str(&body)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Parse, format!("parse: {e}")))?;

    let cmp = semver_cmp(&ctx.current_version, &release.tag_name)
        .map_err(|_| UpdateError::new(UpdateErrorKind::Parse, "semver parse failed"))?;
    let latest_version = release
        .tag_name
        .strip_prefix('v')
        .or_else(|| release.tag_name.strip_prefix('V'))
        .unwrap_or(&release.tag_name)
        .to_string();
    let (status, asset) = decide_status(cmp, select_asset(&release.assets, std::env::consts::OS, std::env::consts::ARCH));

    let mut out = UpdateCheckResult {
        status,
        current_version: ctx.current_version.clone(),
        latest_tag: Some(release.tag_name.clone()),
        latest_version: Some(latest_version),
        published_at: release.published_at.clone(),
        notes_excerpt: notes_excerpt(release.body.as_deref()),
        html_url: release.html_url.clone(),
        asset,
        cache_hit: false,
        checked_at: now_iso8601(),
        latency_ms: start.elapsed().as_millis() as u64,
        error_kind: None,
        error_message: None,
        retry_after_sec: None,
        debug_build: false,
    };

    // Success ⇒ write cache (preserve prompted fields from a previous cache).
    let (prompted_tag, prompted_at) = match &cache {
        Some((c, _)) => (c.prompted_tag.clone(), c.prompted_at.clone()),
        None => (None, None),
    };
    let cached = LastCheckCache {
        parser_version: PARSER_VERSION,
        etag,
        checked_at: out.checked_at.clone(),
        result: CachedResult::from(&out),
        prompted_tag,
        prompted_at,
    };
    write_cache(&ctx.cache_dir, &cached);

    crate::tauri_info!(
        "updates",
        &format!(
            "check ok status={:?} current={} latest={} cache_hit=false latency_ms={} etag_present={}",
            out.status,
            out.current_version,
            out.latest_tag.as_deref().unwrap_or("-"),
            out.latency_ms,
            cached.etag.is_some()
        )
    );
    Ok(out)
}

/// Public core: build client + validate the original URL, then run the check.
/// Errors are folded into `status=Error` results — this fn does not fail.
pub async fn check_inner(app: &AppHandle, force: bool) -> UpdateCheckResult {
    let start = Instant::now();
    let ctx = match CheckContext::from_app(app) {
        Ok(c) => c,
        Err(e) => return e.into_result(&CheckContext { current_version: app.package_info().version.to_string(), cache_dir: PathBuf::new() }, start.elapsed().as_millis() as u64),
    };
    // Original-URL guard (Policy::custom only sees redirect attempts).
    let url = match reqwest::Url::parse(LATEST_URL) {
        Ok(u) => {
            if let Err(e) = assert_allowed(&u) {
                return e.into_result(&ctx, start.elapsed().as_millis() as u64);
            }
            u
        }
        Err(e) => {
            let err = UpdateError::new(UpdateErrorKind::Parse, format!("url: {e}"));
            return err.into_result(&ctx, start.elapsed().as_millis() as u64);
        }
    };
    let client = match check_http_client(app) {
        Ok(c) => c,
        Err(e) => return e.into_result(&ctx, start.elapsed().as_millis() as u64),
    };
    let mut result = match run_check(&ctx, force, &client, url.as_str()).await {
        Ok(r) => r,
        Err(e) => e.into_result(&ctx, start.elapsed().as_millis() as u64),
    };
    result.debug_build = dev_build();
    result
}

// ── Tauri commands (never emit) ──

/// Running-app version + platform info (from the manifest; no hard-coding).
#[tauri::command]
pub fn updates_app_info(app: tauri::AppHandle) -> Result<AppVersionInfo, String> {
    Ok(AppVersionInfo {
        version: app.package_info().version.to_string(),
        debug_build: dev_build(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    })
}

/// Check GitHub latest. Wrapper layer: **never emit** events (KD-13).
#[tauri::command]
pub async fn updates_check(app: tauri::AppHandle, force: Option<bool>) -> Result<UpdateCheckResult, String> {
    Ok(check_inner(&app, force.unwrap_or(false)).await)
}

// ══════════════════════════════════════════════════════════════════════════
// Download / verify / open installer (PR-3)
// ══════════════════════════════════════════════════════════════════════════

const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// No byte for this long ⇒ stall error. Deliberately NOT a total timeout
/// (57MB over a slow proxy needs minutes, never hours like voice's 2h).
const STALL_TIMEOUT: Duration = Duration::from_secs(60);
const PROGRESS_EVERY: Duration = Duration::from_millis(200);
const PROGRESS_BYTES: u64 = 256 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub phase: String, // downloading | verifying | ready | error | cancelled
    pub downloaded: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub asset_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PartialMeta {
    tag: String,
    asset_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected_size: Option<u64>,
    sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
}

/// One download at a time (the UI serializes). Single shared cancel flag.
static DOWNLOAD_CANCEL: std::sync::OnceLock<std::sync::Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>> =
    std::sync::OnceLock::new();

fn cancel_flag() -> std::sync::Arc<std::sync::atomic::AtomicBool> {
    let map = DOWNLOAD_CANCEL.get_or_init(|| std::sync::Mutex::new(None));
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)));
    }
    guard.as_ref().unwrap().clone()
}

/// Download client: same proxy + allowlist as the check client, but with NO
/// short total timeout — a 60s per-chunk stall guard replaces it.
fn download_client(app: &AppHandle) -> Result<reqwest::Client, UpdateError> {
    let mut builder = proxy_client_builder(app)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, e))?;
    builder = builder
        .user_agent(user_agent(app))
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            match assert_allowed(attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(_) => attempt.error("host not allowlisted"),
            }
        }));
    builder
        .build()
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, e.to_string()))
}

/// Parse GNU-coreutils `SHA256SUMS` (`<hex>  <name>` or `<hex> *<name>`).
/// Returns the row for `asset_name` (lowercased hex), or None when absent.
fn parse_sums(body: &str, asset_name: &str) -> Option<String> {
    body.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hex = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        if name == asset_name && hex.len() == 64 && hex.bytes().all(|c| c.is_ascii_hexdigit()) {
            Some(hex.to_ascii_lowercase())
        } else {
            None
        }
    })
}

/// KD-9: SUMS row vs check-stage digest. Missing row ⇒ digest. Row != digest ⇒
/// refuse (never pick a side). Row == digest ⇒ that hex.
fn resolve_expected_sha256(sums_row: Option<String>, digest: &str) -> Result<String, UpdateError> {
    match sums_row {
        None => Ok(digest.to_ascii_lowercase()),
        Some(row) => {
            if row.eq_ignore_ascii_case(digest) {
                Ok(row.to_ascii_lowercase())
            } else {
                Err(UpdateError::new(
                    UpdateErrorKind::Http,
                    "SHA256SUMS row disagrees with the release digest",
                ))
            }
        }
    }
}

fn sha256_file(path: &Path) -> Result<String, UpdateError> {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    let mut file = std::fs::File::open(path)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("open: {e}")))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = std::io::Read::read(&mut file, &mut buf)
            .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("read: {e}")))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn partial_paths(dir: &Path, asset_name: &str) -> (PathBuf, PathBuf) {
    (
        dir.join(format!("{asset_name}.partial")),
        dir.join(format!("{asset_name}.partial.meta.json")),
    )
}

/// Resume is only safe when the meta pins the same payload (tag / name / size /
/// sha256). Any mismatch ⇒ delete and re-download whole — never Range-stitch
/// two different payloads.
fn resume_offset(dir: &Path, asset_name: &str, tag: &str, expected_size: Option<u64>, sha256: &str) -> u64 {
    let (partial, meta_path) = partial_paths(dir, asset_name);
    let ok = std::fs::read_to_string(&meta_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<PartialMeta>(&raw).ok())
        .map(|meta| {
            meta.tag == tag
                && meta.asset_name == asset_name
                && meta.sha256.eq_ignore_ascii_case(sha256)
                && meta.expected_size == expected_size
        })
        .unwrap_or(false);
    if !ok {
        let _ = std::fs::remove_file(&partial);
        let _ = std::fs::remove_file(&meta_path);
        return 0;
    }
    match (expected_size, std::fs::metadata(&partial).map(|m| m.len())) {
        (Some(expected), Ok(len)) if len < expected => len,
        _ => {
            // Unknown size ⇒ Range is forbidden; restart cleanly.
            let _ = std::fs::remove_file(&partial);
            0
        }
    }
}

/// Canonical-prefix guard for opening installers (path traversal defense).
fn checked_installer_path(dir: &Path, requested: &str) -> Result<PathBuf, UpdateError> {
    let canon_dir = std::fs::canonicalize(dir)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Host, format!("cache dir: {e}")))?;
    let canon = std::fs::canonicalize(requested)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Host, format!("installer: {e}")))?;
    if !canon.starts_with(&canon_dir) {
        return Err(UpdateError::host("installer path outside updates cache"));
    }
    Ok(canon)
}

fn parse_content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let v = headers.get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    // `bytes start-end/total`
    let (_, total) = v.split_once('/')?;
    total.trim().parse().ok()
}

/// Dev gate: `yarn tauri dev` must not install release packages. `cargo test`
/// bypasses so inner functions stay testable; `HIP_UPDATES_ALLOW_DEV_INSTALL=1`
/// is the explicit opt-out.
fn dev_gate() -> Result<(), String> {
    if dev_build() && !cfg!(test) {
        return Err("dev_blocked".into());
    }
    Ok(())
}

struct DownloadTarget {
    tag: String,
    asset_name: String,
    url: String,
    sha256: String,
    expected_size: Option<u64>,
    sums_url: String,
}

/// Resolve the download target from the **current check cache** only — the
/// frontend may pass a tag + asset name, never a URL.
fn download_target(dir: &Path, tag: &str, asset_name: &str) -> Result<DownloadTarget, UpdateError> {
    let (cache, usable) = read_cache(dir).ok_or_else(|| {
        UpdateError::new(UpdateErrorKind::Http, "no check result — run a check first")
    })?;
    if !usable {
        return Err(UpdateError::new(UpdateErrorKind::Parse, "check cache is stale"));
    }
    let result = cache.result;
    if result.latest_tag.as_deref() != Some(tag) {
        return Err(UpdateError::new(UpdateErrorKind::Http, "tag does not match the cached check"));
    }
    let asset = result
        .asset
        .ok_or_else(|| UpdateError::new(UpdateErrorKind::Http, "no cached asset for this system"))?;
    if asset.name != asset_name {
        return Err(UpdateError::new(UpdateErrorKind::Http, "asset name does not match the cached check"));
    }
    let sha256 = asset
        .sha256
        .ok_or_else(|| UpdateError::new(UpdateErrorKind::Http, "no checksum — refuse to download"))?;
    Ok(DownloadTarget {
        tag: tag.to_string(),
        asset_name: asset_name.to_string(),
        url: asset.browser_download_url,
        sha256,
        expected_size: Some(asset.size),
        sums_url: format!("https://github.com/limin411/hip/releases/download/{tag}/SHA256SUMS.txt"),
    })
}

/// Mechanics only (testable without an AppHandle): SUMS fetch → sha256 decision
/// → resume-aware download → verify → finalize. Progress flows through `emit`.
async fn download_inner(
    client: &reqwest::Client,
    dir: &Path,
    target: &DownloadTarget,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    emit: &mut (dyn FnMut(UpdateProgress) + Send),
) -> Result<PathBuf, UpdateError> {
    use std::sync::atomic::Ordering;

    // 1) SHA256SUMS.txt (404 ⇒ fall back to the check-stage digest, KD-9).
    let sums_row = {
        let resp = client
            .get(&target.sums_url)
            .send()
            .await
            .map_err(|e| UpdateError::new(UpdateErrorKind::Network, format!("sums network: {e}")))?;
        match resp.status() {
            s if s == reqwest::StatusCode::NOT_FOUND => None,
            s if s.is_success() => {
                let body = resp
                    .text()
                    .await
                    .map_err(|e| UpdateError::new(UpdateErrorKind::Network, format!("sums body: {e}")))?;
                parse_sums(&body, &target.asset_name)
            }
            s => {
                return Err(UpdateError::new(
                    UpdateErrorKind::Http,
                    format!("SHA256SUMS HTTP {s}"),
                ))
            }
        }
    };
    let sha256 = match resolve_expected_sha256(sums_row, &target.sha256) {
        Ok(s) => s,
        Err(e) => {
            emit(UpdateProgress {
                phase: "error".into(),
                downloaded: 0,
                total: None,
                asset_name: target.asset_name.clone(),
                error_kind: Some("hash".into()),
            });
            return Err(e);
        }
    };

    let (partial, meta_path) = partial_paths(dir, &target.asset_name);
    let final_path = dir.join(&target.asset_name);

    // 2) Resume decision (meta-pinned; unknown size ⇒ no Range).
    let resume_from = resume_offset(dir, &target.asset_name, &target.tag, target.expected_size, &sha256);

    let mut req = client.get(&target.url);
    if resume_from > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={resume_from}-"));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| UpdateError::new(UpdateErrorKind::Network, format!("asset network: {e}")))?;
    let status = resp.status();
    let total: Option<u64>;
    let mut downloaded: u64;
    let mut file: std::fs::File;
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        total = parse_content_range_total(resp.headers())
            .or_else(|| resp.content_length().map(|n| resume_from + n))
            .or(target.expected_size);
        downloaded = resume_from;
        file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial)
            .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("open partial: {e}")))?;
    } else if status.is_success() {
        // 200 — full body (server ignored Range): restart cleanly.
        let _ = std::fs::remove_file(&partial);
        total = resp.content_length().or(target.expected_size);
        downloaded = 0;
        file = std::fs::File::create(&partial)
            .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("create partial: {e}")))?;
    } else {
        return Err(UpdateError::new(
            UpdateErrorKind::Http,
            format!("asset HTTP {status}"),
        ));
    }

    emit(UpdateProgress {
        phase: "downloading".into(),
        downloaded,
        total,
        asset_name: target.asset_name.clone(),
        error_kind: None,
    });

    // 3) Stream with 60s stall guard + cancel + throttled progress.
    let mut last_emit = Instant::now();
    let mut since_emit_bytes: u64 = 0;
    let mut resp = resp;
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = file.flush();
            emit(UpdateProgress {
                phase: "cancelled".into(),
                downloaded,
                total,
                asset_name: target.asset_name.clone(),
                error_kind: Some("cancel".into()),
            });
            // Keep .partial so a retry can resume.
            return Err(UpdateError::new(UpdateErrorKind::Http, "cancelled"));
        }
        let chunk = tokio::time::timeout(STALL_TIMEOUT, resp.chunk())
            .await
            .map_err(|_| {
                UpdateError::new(UpdateErrorKind::Network, "stalled: no bytes for 60s")
            })?
            .map_err(|e| UpdateError::new(UpdateErrorKind::Network, format!("asset body: {e}")))?;
        let Some(chunk) = chunk else { break };
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("write partial: {e}")))?;
        let n = chunk.len() as u64;
        downloaded += n;
        since_emit_bytes += n;
        if last_emit.elapsed() >= PROGRESS_EVERY || since_emit_bytes >= PROGRESS_BYTES {
            emit(UpdateProgress {
                phase: "downloading".into(),
                downloaded,
                total,
                asset_name: target.asset_name.clone(),
                error_kind: None,
            });
            last_emit = Instant::now();
            since_emit_bytes = 0;
        }
    }
    std::io::Write::flush(&mut file)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("flush: {e}")))?;
    drop(file);

    // 4) Size + hash verification.
    if let Some(expected) = target.expected_size {
        if downloaded != expected {
            let _ = std::fs::remove_file(&partial);
            emit(UpdateProgress {
                phase: "error".into(),
                downloaded,
                total,
                asset_name: target.asset_name.clone(),
                error_kind: Some("hash".into()),
            });
            return Err(UpdateError::new(
                UpdateErrorKind::Http,
                format!("size mismatch: got {downloaded}, expected {expected}"),
            ));
        }
    }
    emit(UpdateProgress {
        phase: "verifying".into(),
        downloaded,
        total: Some(downloaded),
        asset_name: target.asset_name.clone(),
        error_kind: None,
    });
    let actual = sha256_file(&partial)?;
    if !actual.eq_ignore_ascii_case(&sha256) {
        // Integrity failure: discard everything (final + partial + meta).
        let _ = std::fs::remove_file(&final_path);
        let _ = std::fs::remove_file(&partial);
        let _ = std::fs::remove_file(&meta_path);
        emit(UpdateProgress {
            phase: "error".into(),
            downloaded,
            total: Some(downloaded),
            asset_name: target.asset_name.clone(),
            error_kind: Some("hash".into()),
        });
        return Err(UpdateError::new(UpdateErrorKind::Http, "sha256 mismatch — file discarded"));
    }

    // 5) Finalize: drop the .partial suffix, keep at most this one package.
    std::fs::rename(&partial, &final_path)
        .map_err(|e| UpdateError::new(UpdateErrorKind::Http, format!("finalize: {e}")))?;
    let _ = std::fs::remove_file(&meta_path);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for ent in entries.flatten() {
            let name = ent.file_name();
            let name_s = name.to_string_lossy().to_string();
            if name_s == CACHE_FILE || name_s == target.asset_name {
                continue;
            }
            let keep_partial = name_s == format!("{}.partial", target.asset_name);
            if name_s.ends_with(".dmg")
                || name_s.ends_with(".exe")
                || name_s.ends_with(".partial")
                || name_s.ends_with(".meta.json")
                || keep_partial
            {
                let _ = std::fs::remove_file(ent.path());
            }
        }
    }
    emit(UpdateProgress {
        phase: "ready".into(),
        downloaded,
        total: Some(downloaded),
        asset_name: target.asset_name.clone(),
        error_kind: None,
    });
    crate::tauri_info!(
        "updates",
        &format!("download ok asset={} bytes={}", target.asset_name, downloaded)
    );
    Ok(final_path)
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub path: String,
}

/// Download + verify the release asset for `tag`/`assetName` (both must match
/// the current check cache — the frontend never passes a URL).
#[tauri::command]
pub async fn updates_download(
    app: tauri::AppHandle,
    tag: String,
    asset_name: String,
) -> Result<DownloadOutcome, String> {
    use tauri::Emitter;
    dev_gate()?;
    let dir = paths::updates_cache_dir(&app).ok_or("updates cache unavailable")?;
    let target = download_target(&dir, &tag, &asset_name).map_err(|e| e.message)?;
    // Original-URL guard before GET (Policy::custom only sees hops).
    for u in [&target.url, &target.sums_url] {
        let parsed = reqwest::Url::parse(u).map_err(|e| format!("url: {e}"))?;
        assert_allowed(&parsed).map_err(|e| e.message)?;
    }
    let client = download_client(&app).map_err(|e| e.message)?;
    let cancel = cancel_flag();
    cancel.store(false, std::sync::atomic::Ordering::SeqCst);
    let last_phase = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let result = {
        let lp = last_phase.clone();
        let app_emit = app.clone();
        let mut emit = move |p: UpdateProgress| {
            if let Ok(mut g) = lp.lock() {
                *g = p.phase.clone();
            }
            let _ = app_emit.emit("updates://progress", &p);
        };
        download_inner(&client, &dir, &target, cancel, &mut emit).await
    };
    match result {
        Ok(path) => Ok(DownloadOutcome {
            path: path.to_string_lossy().to_string(),
        }),
        Err(e) => {
            // Inner paths already emit error/cancelled for hash/cancel; this
            // catch-all covers network / http / SUMS-disagreement failures so
            // the UI always sees a terminal progress event.
            let phase = last_phase.lock().map(|g| g.clone()).unwrap_or_default();
            if phase != "error" && phase != "cancelled" {
                let kind = e.kind.as_str().to_string();
                let _ = app.emit(
                    "updates://progress",
                    &UpdateProgress {
                        phase: "error".into(),
                        downloaded: 0,
                        total: None,
                        asset_name: asset_name.clone(),
                        error_kind: Some(kind),
                    },
                );
            }
            Err(e.message)
        }
    }
}

#[tauri::command]
pub fn updates_cancel_download() -> Result<(), String> {
    if let Some(map) = DOWNLOAD_CANCEL.get() {
        if let Ok(guard) = map.lock() {
            if let Some(flag) = guard.as_ref() {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
    }
    Ok(())
}

/// Open a verified installer. The path must canonicalize under the updates
/// cache (rejects `../` escapes). Opener failure is a soft error — no panic.
#[tauri::command]
pub fn updates_open_installer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = paths::updates_cache_dir(&app).ok_or("updates cache unavailable")?;
    let canon = checked_installer_path(&dir, &path).map_err(|e| e.message)?;
    app.opener()
        .open_path(canon.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("opener failed: {e}"))
}

/// Open the GitHub Releases page. Host is pinned (no arbitrary URLs).
#[tauri::command]
pub fn updates_open_release_page(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://github.com/limin411/hip/releases") {
        return Err("url must be a github.com/limin411/hip/releases page".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("opener failed: {e}"))
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    // ── semver ──

    #[test]
    fn semver_basic_table() {
        assert_eq!(semver_cmp("1.0.1", "v1.0.2").unwrap(), Ordering::Less);
        assert_eq!(semver_cmp("v1.0.1", "1.0.1").unwrap(), Ordering::Equal);
        assert_eq!(semver_cmp("1.0.2-dev", "1.0.1").unwrap(), Ordering::Greater);
        assert_eq!(semver_cmp("1.0.1-dev", "1.0.1").unwrap(), Ordering::Less);
        assert_eq!(semver_cmp("2.0.0", "v10.0.0").unwrap(), Ordering::Less);
        assert_eq!(semver_cmp("1.0.1", "V1.0.1").unwrap(), Ordering::Equal);
    }

    #[test]
    fn semver_build_metadata_and_segments() {
        assert_eq!(semver_cmp("1.0.1+build.7", "1.0.1").unwrap(), Ordering::Equal);
        assert_eq!(semver_cmp("1.0", "1.0.1").unwrap(), Ordering::Less);
        assert_eq!(semver_cmp("1.0.1.5", "1.0.1").unwrap(), Ordering::Equal);
        assert_eq!(semver_cmp(" 1.0.2 ", "1.0.1").unwrap(), Ordering::Greater);
    }

    #[test]
    fn semver_illegal_inputs_error() {
        assert!(semver_cmp("abc", "1.0.1").is_err());
        assert!(semver_cmp("1.0.x", "1.0.1").is_err());
        assert!(semver_cmp("", "1.0.1").is_err());
        assert!(semver_cmp("1.0.1", "not-a-version").is_err());
    }

    // ── asset selection ──

    fn asset(name: &str) -> GithubAsset {
        GithubAsset {
            name: name.into(),
            size: 1000,
            content_type: None,
            browser_download_url: format!("https://github.com/x/releases/download/v1/{name}"),
            digest: Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        }
    }

    const FIXTURE: &str = r#"{
      "tag_name": "v1.0.2",
      "published_at": "2026-08-23T12:00:00Z",
      "body": "notes",
      "html_url": "https://github.com/limin411/hip/releases/tag/v1.0.2",
      "assets": [
        {"name": "hip_1.0.2_aarch64.dmg", "size": 100, "browser_download_url": "https://x/a.dmg", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        {"name": "hip_1.0.2_x64-setup.exe", "size": 100, "browser_download_url": "https://x/a.exe"},
        {"name": "hip.app.tar.gz", "size": 100, "browser_download_url": "https://x/a.tar.gz"},
        {"name": "SHA256SUMS.txt", "size": 10, "browser_download_url": "https://x/SHA256SUMS.txt"}
      ]
    }"#;

    fn fixture_release() -> GithubRelease {
        serde_json::from_str(FIXTURE).unwrap()
    }

    #[test]
    fn asset_macos_aarch64_prefers_dmg() {
        let r = fixture_release();
        let a = select_asset(&r.assets, "macos", "aarch64").unwrap();
        assert_eq!(a.name, "hip_1.0.2_aarch64.dmg");
    }

    #[test]
    fn asset_macos_x86_64_does_not_get_aarch64_dmg() {
        let r = fixture_release();
        // x64 dmg absent → None, and the aarch64 dmg must NOT match.
        assert!(select_asset(&r.assets, "macos", "x86_64").is_none());
    }

    #[test]
    fn asset_windows_x64_hits_setup_exe() {
        let r = fixture_release();
        let a = select_asset(&r.assets, "windows", "x86_64").unwrap();
        assert_eq!(a.name, "hip_1.0.2_x64-setup.exe");
    }

    #[test]
    fn asset_windows_aarch64_does_not_fall_back_to_x64() {
        let r = fixture_release();
        assert!(select_asset(&r.assets, "windows", "aarch64").is_none());
    }

    #[test]
    fn asset_linux_never_matches() {
        let r = fixture_release();
        assert!(select_asset(&r.assets, "linux", "x86_64").is_none());
        assert!(select_asset(&r.assets, "linux", "aarch64").is_none());
    }

    #[test]
    fn asset_name_matching_is_case_insensitive() {
        let r = GithubRelease {
            tag_name: "v1.0.2".into(),
            published_at: None,
            body: None,
            html_url: None,
            assets: vec![asset("HIP_1.0.2_X64-Setup.EXE")],
        };
        assert!(select_asset(&r.assets, "windows", "x86_64").is_some());
    }

    // ── digest ──

    #[test]
    fn digest_sha256_parses_valid_hex() {
        let a = asset("x.dmg");
        assert_eq!(
            digest_sha256(&a).as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
    }

    #[test]
    fn digest_sha256_rejects_missing_or_bad() {
        let mut a = asset("x.dmg");
        a.digest = None;
        assert!(digest_sha256(&a).is_none());
        a.digest = Some("sha256:zzzz".into());
        assert!(digest_sha256(&a).is_none());
        a.digest = Some("md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into());
        assert!(digest_sha256(&a).is_none());
    }

    // ── status decision ──

    #[test]
    fn decide_status_table() {
        let r = fixture_release();
        // Equal → up to date, no asset.
        let (s, a) = decide_status(Ordering::Equal, None);
        assert_eq!(s, UpdateCheckStatus::UpToDate);
        assert!(a.is_none());
        // Greater → ahead.
        let (s, a) = decide_status(Ordering::Greater, None);
        assert_eq!(s, UpdateCheckStatus::CurrentAhead);
        assert!(a.is_none());
        // Less, no asset → no_matching_asset.
        let (s, a) = decide_status(Ordering::Less, None);
        assert_eq!(s, UpdateCheckStatus::NoMatchingAsset);
        assert!(a.is_none());
        // Less, asset with digest → update_available + sha256.
        let picked = select_asset(&r.assets, "macos", "aarch64").unwrap();
        let (s, a) = decide_status(Ordering::Less, Some(picked.clone()));
        assert_eq!(s, UpdateCheckStatus::UpdateAvailable);
        assert!(a.as_ref().unwrap().sha256.is_some());
        // Less, asset WITHOUT digest → update_available, sha256 absent.
        let mut no_digest = picked;
        no_digest.digest = None;
        let (s, a) = decide_status(Ordering::Less, Some(no_digest));
        assert_eq!(s, UpdateCheckStatus::UpdateAvailable);
        assert!(a.unwrap().sha256.is_none());
    }

    // ── parse / notes ──

    #[test]
    fn parse_fixture_release() {
        let r = fixture_release();
        assert_eq!(r.tag_name, "v1.0.2");
        assert_eq!(r.assets.len(), 4);
    }

    #[test]
    fn notes_excerpt_truncates_on_char_boundary() {
        let long = "界".repeat(300);
        let out = notes_excerpt(Some(&long)).unwrap();
        assert_eq!(out.chars().count(), 281); // 280 + ellipsis
        assert!(out.ends_with('…'));
        assert!(notes_excerpt(Some("  ")).is_none());
        assert!(notes_excerpt(None).is_none());
    }

    // ── allowlist ──

    #[test]
    fn assert_allowed_rejects_http_original_url() {
        // http://evil.test as the ORIGINAL URL (not just a hop).
        let u = reqwest::Url::parse("http://evil.test/installer").unwrap();
        let err = assert_allowed(&u).unwrap_err();
        assert_eq!(err.kind, UpdateErrorKind::Host);
    }

    #[test]
    fn assert_allowed_rejects_unknown_https_host() {
        let u = reqwest::Url::parse("https://evil.test/x").unwrap();
        let err = assert_allowed(&u).unwrap_err();
        assert_eq!(err.kind, UpdateErrorKind::Host);
    }

    #[test]
    fn assert_allowed_accepts_allowlisted_hosts() {
        for host in ALLOWED_HOSTS {
            let u = reqwest::Url::parse(&format!("https://{host}/x")).unwrap();
            assert!(assert_allowed(&u).is_ok(), "{host}");
        }
    }

    // ── ISO-8601 round trip ──

    #[test]
    fn iso8601_round_trips() {
        for unix in [0, 1_600_000_000, 1_752_900_000, 4_102_444_800] {
            let s = format_iso8601(unix);
            assert_eq!(iso8601_to_unix(&s), Some(unix), "{s}");
        }
        assert!(iso8601_to_unix("garbage").is_none());
        assert!(iso8601_to_unix("2026-13-01T00:00:00Z").is_none());
    }

    // ── cache rules ──

    fn temp_cache_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hip-updates-{tag}-{}-{}", std::process::id(), now_unix()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cache_round_trips_and_parser_version_guards() {
        let dir = temp_cache_dir("roundtrip");
        let r = UpdateCheckResult {
            status: UpdateCheckStatus::UpToDate,
            current_version: "1.0.1".into(),
            latest_tag: Some("v1.0.1".into()),
            latest_version: Some("1.0.1".into()),
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: None,
            cache_hit: false,
            checked_at: "2026-08-23T12:00:00Z".into(),
            latency_ms: 3,
            error_kind: None,
            error_message: None,
            retry_after_sec: None,
            debug_build: true,
        };
        let cache = LastCheckCache {
            parser_version: PARSER_VERSION,
            etag: Some("W/\"abc\"".into()),
            checked_at: r.checked_at.clone(),
            result: CachedResult::from(&r),
            prompted_tag: Some("v1.0.2".into()),
            prompted_at: Some("2026-08-24T00:00:00Z".into()),
        };
        write_cache(&dir, &cache);
        let (back, usable) = read_cache(&dir).unwrap();
        assert!(usable);
        assert_eq!(back.etag.as_deref(), Some("W/\"abc\""));
        assert_eq!(back.result.status, UpdateCheckStatus::UpToDate);
        assert_eq!(back.prompted_tag.as_deref(), Some("v1.0.2"));
        // Cache JSON must NOT carry runtime-only fields.
        let raw = std::fs::read_to_string(cache_path(&dir)).unwrap();
        assert!(!raw.contains("debugBuild"), "{raw}");
        assert!(!raw.contains("cacheHit"), "{raw}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cache_parser_version_mismatch_is_unusable() {
        let dir = temp_cache_dir("parserver");
        let cache = LastCheckCache {
            parser_version: 99,
            etag: Some("W/\"old\"".into()),
            checked_at: "2026-08-23T12:00:00Z".into(),
            result: CachedResult {
                status: UpdateCheckStatus::UpToDate,
                current_version: "1.0.1".into(),
                latest_tag: None,
                latest_version: None,
                published_at: None,
                notes_excerpt: None,
                html_url: None,
                asset: None,
                checked_at: "2026-08-23T12:00:00Z".into(),
                latency_ms: 0,
                error_kind: None,
                error_message: None,
                retry_after_sec: None,
            },
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(&dir, &cache);
        let (_, usable) = read_cache(&dir).unwrap();
        assert!(!usable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cache_mode_is_0600() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = temp_cache_dir("mode");
            let r = UpdateCheckResult {
                status: UpdateCheckStatus::UpToDate,
                current_version: "1.0.1".into(),
                latest_tag: None,
                latest_version: None,
                published_at: None,
                notes_excerpt: None,
                html_url: None,
                asset: None,
                cache_hit: false,
                checked_at: "2026-08-23T12:00:00Z".into(),
                latency_ms: 0,
                error_kind: None,
                error_message: None,
                retry_after_sec: None,
                debug_build: false,
            };
            let cache = LastCheckCache {
                parser_version: PARSER_VERSION,
                etag: None,
                checked_at: r.checked_at.clone(),
                result: CachedResult::from(&r),
                prompted_tag: None,
                prompted_at: None,
            };
            write_cache(&dir, &cache);
            let mode = std::fs::metadata(cache_path(&dir)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "expected 0600, got {mode:o}");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    // ── HTTP-path tests against an in-process mock server (no external net) ──

    struct MockRequest {
        if_none_match: bool,
    }

    async fn serve(
        responses: Vec<(&'static str, Vec<(&'static str, String)>, Vec<u8>)>,
    ) -> (String, tokio::sync::mpsc::Receiver<MockRequest>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::mpsc::channel(8);
        tokio::spawn(async move {
            for (status_line, headers, body) in responses {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = Vec::new();
                let mut tmp = [0u8; 2048];
                loop {
                    let n = sock.read(&mut tmp).await.unwrap();
                    buf.extend_from_slice(&tmp[..n]);
                    if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let head = String::from_utf8_lossy(&buf).to_ascii_lowercase();
                let _ = tx
                    .send(MockRequest {
                        if_none_match: head.contains("if-none-match:"),
                    })
                    .await;
                let mut resp = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Length: {}\r\nConnection: close\r\n",
                    body.len()
                );
                for (k, v) in headers {
                    resp.push_str(&format!("{k}: {v}\r\n"));
                }
                resp.push_str("\r\n");
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.write_all(&body).await;
            }
        });
        (format!("http://{addr}/"), rx)
    }

    fn ok_ctx(tag: &str) -> CheckContext {
        CheckContext {
            current_version: "1.0.1".into(),
            cache_dir: temp_cache_dir(tag),
        }
    }

    fn plain_client() -> reqwest::Client {
        reqwest::Client::builder().build().unwrap()
    }

    /// Fixture with a matching asset for every supported non-Linux host, so
    /// the status assertion is platform-independent.
    fn good_body() -> String {
        let assets = r#"[
            {"name":"hip_1.0.2_aarch64.dmg","size":100,"browser_download_url":"https://github.com/limin411/hip/releases/download/v1.0.2/hip_1.0.2_aarch64.dmg","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            {"name":"hip_1.0.2_x64.dmg","size":100,"browser_download_url":"https://x/x64.dmg","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            {"name":"hip_1.0.2_x64-setup.exe","size":100,"browser_download_url":"https://x/x64.exe","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            {"name":"hip_1.0.2_arm64-setup.exe","size":100,"browser_download_url":"https://x/arm64.exe","digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
        ]"#;
        format!(
            "{{\"tag_name\":\"v1.0.2\",\"published_at\":\"2026-08-23T12:00:00Z\",\"body\":\"notes\",\"html_url\":\"https://github.com/limin411/hip/releases/tag/v1.0.2\",\"assets\":{assets}}}"
        )
    }

    /// Expected status for `good_body()` on this host.
    fn expected_good_status() -> UpdateCheckStatus {
        let r: GithubRelease = serde_json::from_str(&good_body()).unwrap();
        let cmp = semver_cmp("1.0.1", &r.tag_name).unwrap();
        let (status, _) = decide_status(
            cmp,
            select_asset(&r.assets, std::env::consts::OS, std::env::consts::ARCH),
        );
        status
    }

    #[tokio::test]
    async fn force_true_sends_no_if_none_match_and_writes_cache() {
        let (url, mut rx) = serve(vec![(
            "200 OK",
            vec![("ETag".into(), "W/\"abc\"".into())],
            good_body().into_bytes(),
        )])
        .await;
        let ctx = ok_ctx("force-true");
        let out = run_check(&ctx, true, &plain_client(), &url).await.unwrap();
        assert_eq!(out.status, expected_good_status());
        assert_eq!(out.latest_tag.as_deref(), Some("v1.0.2"));
        assert_eq!(out.latest_version.as_deref(), Some("1.0.2"));
        assert!(!out.cache_hit);
        if expected_good_status() == UpdateCheckStatus::UpdateAvailable {
            assert!(out.asset.unwrap().sha256.is_some());
        }
        let req = rx.recv().await.unwrap();
        assert!(!req.if_none_match, "force=true must not send If-None-Match");
        // Cache written with etag.
        let (c, usable) = read_cache(&ctx.cache_dir).unwrap();
        assert!(usable);
        assert_eq!(c.etag.as_deref(), Some("W/\"abc\""));
        let _ = std::fs::remove_dir_all(&ctx.cache_dir);
    }

    #[tokio::test]
    async fn force_false_with_etag_304_restores_cache() {
        let dir = ok_ctx("etag-304").cache_dir;
        // Seed a successful cache first.
        let seeded = UpdateCheckResult {
            status: UpdateCheckStatus::UpToDate,
            current_version: "1.0.1".into(),
            latest_tag: Some("v1.0.1".into()),
            latest_version: Some("1.0.1".into()),
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: None,
            cache_hit: false,
            checked_at: "2020-01-01T00:00:00Z".into(), // old ⇒ TTL expired ⇒ real GET
            latency_ms: 0,
            error_kind: None,
            error_message: None,
            retry_after_sec: None,
            debug_build: false,
        };
        let cache = LastCheckCache {
            parser_version: PARSER_VERSION,
            etag: Some("W/\"abc\"".into()),
            checked_at: seeded.checked_at.clone(),
            result: CachedResult::from(&seeded),
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(&dir, &cache);

        let (url, mut rx) = serve(vec![("304 Not Modified", vec![], Vec::new())]).await;
        let ctx = CheckContext {
            current_version: "1.0.1".into(),
            cache_dir: dir.clone(),
        };
        let out = run_check(&ctx, false, &plain_client(), &url).await.unwrap();
        assert!(out.cache_hit);
        assert_eq!(out.status, UpdateCheckStatus::UpToDate);
        let req = rx.recv().await.unwrap();
        assert!(req.if_none_match, "force=false must send cached ETag");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn fresh_cache_short_circuits_without_http() {
        let dir = ok_ctx("fresh-cache").cache_dir;
        let seeded = UpdateCheckResult {
            status: UpdateCheckStatus::UpToDate,
            current_version: "1.0.1".into(),
            latest_tag: Some("v1.0.1".into()),
            latest_version: Some("1.0.1".into()),
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: None,
            cache_hit: false,
            checked_at: format_iso8601(now_unix()), // fresh ⇒ no network
            latency_ms: 0,
            error_kind: None,
            error_message: None,
            retry_after_sec: None,
            debug_build: false,
        };
        let cache = LastCheckCache {
            parser_version: PARSER_VERSION,
            etag: None,
            checked_at: seeded.checked_at.clone(),
            result: CachedResult::from(&seeded),
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(&dir, &cache);

        let ctx = CheckContext {
            current_version: "1.0.1".into(),
            cache_dir: dir.clone(),
        };
        // No server: if run_check tried the network it would fail.
        let out = run_check(&ctx, false, &plain_client(), "http://127.0.0.1:1/").await.unwrap();
        assert!(out.cache_hit);
        assert_eq!(out.status, UpdateCheckStatus::UpToDate);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn rate_limit_keeps_previous_successful_cache() {
        let dir = ok_ctx("rate-limit").cache_dir;
        // Seed a good cache (TTL-expired so the 429 path is exercised).
        let seeded = UpdateCheckResult {
            status: UpdateCheckStatus::UpToDate,
            current_version: "1.0.1".into(),
            latest_tag: Some("v1.0.1".into()),
            latest_version: Some("1.0.1".into()),
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: None,
            cache_hit: false,
            checked_at: "2020-01-01T00:00:00Z".into(),
            latency_ms: 0,
            error_kind: None,
            error_message: None,
            retry_after_sec: None,
            debug_build: false,
        };
        let cache = LastCheckCache {
            parser_version: PARSER_VERSION,
            etag: Some("W/\"keep-me\"".into()),
            checked_at: seeded.checked_at.clone(),
            result: CachedResult::from(&seeded),
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(&dir, &cache);

        let (url, _rx) = serve(vec![(
            "429 Too Many Requests",
            vec![("Retry-After".into(), "120".into())],
            Vec::new(),
        )])
        .await;
        let ctx = CheckContext {
            current_version: "1.0.1".into(),
            cache_dir: dir.clone(),
        };
        let err = run_check(&ctx, true, &plain_client(), &url).await.unwrap_err();
        assert_eq!(err.kind, UpdateErrorKind::RateLimit);
        assert_eq!(err.retry_after_sec, Some(120));
        // Previous successful cache untouched.
        let (c, _) = read_cache(&dir).unwrap();
        assert_eq!(c.etag.as_deref(), Some("W/\"keep-me\""));
        assert_eq!(c.result.status, UpdateCheckStatus::UpToDate);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn http_and_parse_errors_map_to_kinds() {
        let (url, _rx) = serve(vec![("500 Internal Server Error", vec![], b"boom".to_vec())]).await;
        let ctx = ok_ctx("http-errors");
        let err = run_check(&ctx, true, &plain_client(), &url).await.unwrap_err();
        assert_eq!(err.kind, UpdateErrorKind::Http);

        let (url2, _rx2) = serve(vec![("200 OK", vec![], b"<html>not json</html>".to_vec())]).await;
        let err = run_check(&ctx, true, &plain_client(), &url2).await.unwrap_err();
        assert_eq!(err.kind, UpdateErrorKind::Parse);
        let _ = std::fs::remove_dir_all(&ctx.cache_dir);
    }

    #[tokio::test]
    async fn damaged_cache_with_304_refetches_without_etag() {
        let dir = ok_ctx("damaged-304").cache_dir;
        // Corrupt cache: etag present, but result unusable (parserVersion != 1).
        let cache = LastCheckCache {
            parser_version: 42,
            etag: Some("W/\"stale\"".into()),
            checked_at: "2020-01-01T00:00:00Z".into(),
            result: CachedResult {
                status: UpdateCheckStatus::UpToDate,
                current_version: "1.0.1".into(),
                latest_tag: None,
                latest_version: None,
                published_at: None,
                notes_excerpt: None,
                html_url: None,
                asset: None,
                checked_at: "2020-01-01T00:00:00Z".into(),
                latency_ms: 0,
                error_kind: None,
                error_message: None,
                retry_after_sec: None,
            },
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(&dir, &cache);

        let (url, mut rx) = serve(vec![
            ("304 Not Modified", vec![], Vec::new()),
            ("200 OK", vec![], good_body().into_bytes()),
        ])
        .await;
        let ctx = CheckContext {
            current_version: "1.0.1".into(),
            cache_dir: dir.clone(),
        };
        let out = run_check(&ctx, false, &plain_client(), &url).await.unwrap();
        assert_eq!(out.status, expected_good_status());
        assert!(!out.cache_hit);
        let r1 = rx.recv().await.unwrap();
        assert!(!r1.if_none_match, "unusable cache must not send If-None-Match");
        let r2 = rx.recv().await.unwrap();
        assert!(!r2.if_none_match, "the re-GET must also skip If-None-Match");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dev_build_flag_respects_allow_env() {
        // In test builds debug_assertions is on; the env override must flip it.
        unsafe { std::env::set_var("HIP_UPDATES_ALLOW_DEV_INSTALL", "1") };
        assert!(!dev_build());
        unsafe { std::env::remove_var("HIP_UPDATES_ALLOW_DEV_INSTALL") };
        assert!(dev_build());
    }

    // ── PR-3: sums / sha256 / resume / path guard ──

    #[test]
    fn parse_sums_gnu_and_binary_formats() {
        let body = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  hip_1.0.2_aarch64.dmg\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *other.exe\n";
        assert_eq!(
            parse_sums(body, "hip_1.0.2_aarch64.dmg").as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
        assert_eq!(
            parse_sums(body, "other.exe").as_deref(),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        );
        assert!(parse_sums(body, "missing.dmg").is_none());
        // Uppercase hex + extra spaces still parse.
        let mixed = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC   hip_1.0.2_x64-setup.exe";
        assert_eq!(
            parse_sums(mixed, "hip_1.0.2_x64-setup.exe").as_deref(),
            Some("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
        );
    }

    #[test]
    fn resolve_expected_sha256_rules() {
        let digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        // No SUMS row → digest.
        assert_eq!(resolve_expected_sha256(None, digest).unwrap(), digest);
        // Row == digest → ok (case-insensitive).
        let upper = digest.to_ascii_uppercase();
        assert_eq!(
            resolve_expected_sha256(Some(upper.clone()), digest).unwrap(),
            upper.to_ascii_lowercase()
        );
        // Row != digest → refuse, never pick a side.
        let other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        assert!(resolve_expected_sha256(Some(other.into()), digest).is_err());
    }

    #[test]
    fn sha256_file_known_vector() {
        let dir = temp_cache_dir("sha-file");
        let p = dir.join("payload.bin");
        std::fs::write(&p, b"hello hip").unwrap();
        let hex = sha256_file(&p).unwrap();
        // Precomputed sha256 of "hello hip".
        assert_eq!(
            hex,
            "b001ca0f86c4be1c2494897cd34122e9fec18ab3801c74310f9b718b5017ce2b"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_offset_meta_rules() {
        let dir = temp_cache_dir("resume");
        let (partial, meta_path) = partial_paths(&dir, "hip_1.0.2_aarch64.dmg");
        let sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let write_meta = |tag: &str, size: Option<u64>, s: &str| {
            let meta = PartialMeta {
                tag: tag.into(),
                asset_name: "hip_1.0.2_aarch64.dmg".into(),
                expected_size: size,
                sha256: s.into(),
                etag: None,
            };
            std::fs::write(&meta_path, serde_json::to_string(&meta).unwrap()).unwrap();
            std::fs::write(&partial, vec![0u8; 100]).unwrap();
        };

        // Matching meta + partial < expected → resume from partial len.
        write_meta("v1.0.2", Some(1000), sha);
        assert_eq!(
            resume_offset(&dir, "hip_1.0.2_aarch64.dmg", "v1.0.2", Some(1000), sha),
            100
        );
        // Tag mismatch → wipe + full download.
        write_meta("v9.9.9", Some(1000), sha);
        assert_eq!(
            resume_offset(&dir, "hip_1.0.2_aarch64.dmg", "v1.0.2", Some(1000), sha),
            0
        );
        assert!(!partial.exists(), "mismatched partial must be deleted");
        // Size mismatch → wipe.
        write_meta("v1.0.2", Some(999), sha);
        assert_eq!(
            resume_offset(&dir, "hip_1.0.2_aarch64.dmg", "v1.0.2", Some(1000), sha),
            0
        );
        // Unknown expected size → no Range, wipe.
        write_meta("v1.0.2", None, sha);
        assert_eq!(
            resume_offset(&dir, "hip_1.0.2_aarch64.dmg", "v1.0.2", None, sha),
            0
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn checked_installer_path_rejects_escape() {
        let dir = temp_cache_dir("path-guard");
        // Create a sibling secret to canonicalize against.
        let parent = dir.parent().unwrap();
        let secret = parent.join("secret.txt");
        std::fs::write(&secret, b"x").unwrap();
        let escape = dir.join("../secret.txt");
        assert!(checked_installer_path(&dir, escape.to_str().unwrap()).is_err());
        // A file inside the dir is fine.
        let inside = dir.join("hip_1.0.2_aarch64.dmg");
        std::fs::write(&inside, b"x").unwrap();
        let ok = checked_installer_path(&dir, inside.to_str().unwrap()).unwrap();
        assert!(ok.starts_with(std::fs::canonicalize(&dir).unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn dev_gate_passes_under_test_but_blocks_dev() {
        // Under cargo test the gate always passes (inner functions stay testable).
        assert!(dev_gate().is_ok());
    }

    #[test]
    fn download_target_reads_only_cache() {
        let dir = temp_cache_dir("target");
        // No cache → refused.
        assert!(download_target(&dir, "v1.0.2", "x.dmg").is_err());
        // Seed a cache.
        let asset = UpdateAsset {
            name: "hip_1.0.2_aarch64.dmg".into(),
            size: 1000,
            content_type: None,
            browser_download_url: "https://github.com/limin411/hip/releases/download/v1.0.2/hip_1.0.2_aarch64.dmg".into(),
            sha256: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        };
        let r = UpdateCheckResult {
            status: UpdateCheckStatus::UpdateAvailable,
            current_version: "1.0.1".into(),
            latest_tag: Some("v1.0.2".into()),
            latest_version: Some("1.0.2".into()),
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: Some(asset),
            cache_hit: false,
            checked_at: "2026-08-23T12:00:00Z".into(),
            latency_ms: 0,
            error_kind: None,
            error_message: None,
            retry_after_sec: None,
            debug_build: false,
        };
        let cache = LastCheckCache {
            parser_version: PARSER_VERSION,
            etag: None,
            checked_at: r.checked_at.clone(),
            result: CachedResult::from(&r),
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(&dir, &cache);
        let t = download_target(&dir, "v1.0.2", "hip_1.0.2_aarch64.dmg").unwrap();
        assert_eq!(t.expected_size, Some(1000));
        assert!(t.sums_url.ends_with("v1.0.2/SHA256SUMS.txt"));
        // Wrong tag / wrong asset name → refused.
        assert!(download_target(&dir, "v1.0.3", "hip_1.0.2_aarch64.dmg").is_err());
        assert!(download_target(&dir, "v1.0.2", "other.exe").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── PR-3: end-to-end download against the mock server ──

    fn seed_asset_cache(dir: &Path, asset_name: &str, size: u64, sha256: &str) {
        let asset = UpdateAsset {
            name: asset_name.into(),
            size,
            content_type: None,
            browser_download_url: "http://127.0.0.1:9/asset".into(), // replaced by caller via target override
            sha256: Some(sha256.into()),
        };
        let r = UpdateCheckResult {
            status: UpdateCheckStatus::UpdateAvailable,
            current_version: "1.0.1".into(),
            latest_tag: Some("v1.0.2".into()),
            latest_version: Some("1.0.2".into()),
            published_at: None,
            notes_excerpt: None,
            html_url: None,
            asset: Some(asset),
            cache_hit: false,
            checked_at: "2026-08-23T12:00:00Z".into(),
            latency_ms: 0,
            error_kind: None,
            error_message: None,
            retry_after_sec: None,
            debug_build: false,
        };
        let cache = LastCheckCache {
            parser_version: PARSER_VERSION,
            etag: None,
            checked_at: r.checked_at.clone(),
            result: CachedResult::from(&r),
            prompted_tag: None,
            prompted_at: None,
        };
        write_cache(dir, &cache);
    }

    fn payload_hex(body: &[u8]) -> String {
        use sha2::Digest;
        let mut hasher = sha2::Sha256::new();
        hasher.update(body);
        format!("{:x}", hasher.finalize())
    }

    #[tokio::test]
    async fn download_end_to_end_verifies_and_finalizes() {
        let dir = temp_cache_dir("dl-e2e");
        let asset_name = "hip_1.0.2_aarch64.dmg";
        let payload: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let hex = payload_hex(&payload);
        seed_asset_cache(&dir, asset_name, payload.len() as u64, &hex);

        let sums_body = format!("{hex}  {asset_name}\n");
        let (url, mut rx) = serve(vec![
            ("200 OK", vec![], sums_body.into_bytes()),
            ("200 OK", vec![], payload.clone()),
        ])
        .await;
        let base = url.trim_end_matches('/');
        let target = DownloadTarget {
            tag: "v1.0.2".into(),
            asset_name: asset_name.into(),
            url: format!("{base}/asset"),
            sha256: hex.clone(),
            expected_size: Some(payload.len() as u64),
            sums_url: format!("{base}/SHA256SUMS.txt"),
        };
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut phases: Vec<String> = Vec::new();
        let out = download_inner(&plain_client(), &dir, &target, cancel, &mut |p| phases.push(p.phase.clone()))
            .await
            .unwrap();
        assert!(out.ends_with(asset_name));
        assert!(phases.contains(&"downloading".to_string()));
        assert!(phases.contains(&"verifying".to_string()));
        assert_eq!(phases.last().map(String::as_str), Some("ready"));
        // Final file exists with exact bytes; partial + meta gone.
        let final_path = dir.join(asset_name);
        assert_eq!(std::fs::read(&final_path).unwrap(), payload);
        assert!(!dir.join(format!("{asset_name}.partial")).exists());
        assert!(!dir.join(format!("{asset_name}.partial.meta.json")).exists());
        // Two requests: SUMS + asset.
        let _ = rx.recv().await;
        let _ = rx.recv().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn download_hash_mismatch_discards_files() {
        let dir = temp_cache_dir("dl-mismatch");
        let asset_name = "hip_1.0.2_aarch64.dmg";
        let payload = b"corrupt payload".to_vec();
        // Digest and SUMS agree on a WRONG hex → verify must fail and delete.
        let wrong = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        seed_asset_cache(&dir, asset_name, payload.len() as u64, wrong);

        let sums_body = format!("{wrong}  {asset_name}\n");
        let (url, _rx) = serve(vec![
            ("200 OK", vec![], sums_body.into_bytes()),
            ("200 OK", vec![], payload.clone()),
        ])
        .await;
        let base = url.trim_end_matches('/');
        let target = DownloadTarget {
            tag: "v1.0.2".into(),
            asset_name: asset_name.into(),
            url: format!("{base}/asset"),
            sha256: wrong.into(),
            expected_size: Some(payload.len() as u64),
            sums_url: format!("{base}/SHA256SUMS.txt"),
        };
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut phases: Vec<String> = Vec::new();
        let err = download_inner(&plain_client(), &dir, &target, cancel, &mut |p| phases.push(p.phase.clone()))
            .await
            .unwrap_err();
        assert!(err.message.contains("sha256 mismatch"), "{}", err.message);
        assert_eq!(phases.last().map(String::as_str), Some("error"));
        // Everything discarded.
        assert!(!dir.join(asset_name).exists());
        assert!(!dir.join(format!("{asset_name}.partial")).exists());
        assert!(!dir.join(format!("{asset_name}.partial.meta.json")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn download_sums_digest_disagreement_refuses_before_asset_fetch() {
        let dir = temp_cache_dir("dl-disagree");
        let asset_name = "hip_1.0.2_aarch64.dmg";
        let digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let sums_hex = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        seed_asset_cache(&dir, asset_name, 100, digest);

        let sums_body = format!("{sums_hex}  {asset_name}\n");
        let (url, _rx) = serve(vec![("200 OK", vec![], sums_body.into_bytes())]).await;
        let base = url.trim_end_matches('/');
        let target = DownloadTarget {
            tag: "v1.0.2".into(),
            asset_name: asset_name.into(),
            url: format!("{base}/asset"),
            sha256: digest.into(),
            expected_size: Some(100),
            sums_url: format!("{base}/SHA256SUMS.txt"),
        };
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut phases: Vec<String> = Vec::new();
        let err = download_inner(&plain_client(), &dir, &target, cancel, &mut |p| phases.push(p.phase.clone()))
            .await
            .unwrap_err();
        assert!(err.message.contains("disagrees"), "{}", err.message);
        // Exactly one progress event: the error (hash) terminal state.
        assert_eq!(phases, vec!["error".to_string()]);
        assert!(!dir.join(asset_name).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn download_meta_change_restarts_full_get_without_range() {
        let dir = temp_cache_dir("dl-resume");
        let asset_name = "hip_1.0.2_aarch64.dmg";
        let payload: Vec<u8> = (0..50_000u32).map(|i| (i % 251) as u8).collect();
        let hex = payload_hex(&payload);
        seed_asset_cache(&dir, asset_name, payload.len() as u64, &hex);

        // Pre-seed a partial + meta from a DIFFERENT tag (stale).
        let (partial, meta_path) = partial_paths(&dir, asset_name);
        std::fs::write(&partial, vec![0u8; 4096]).unwrap();
        let stale_meta = PartialMeta {
            tag: "v9.9.9".into(),
            asset_name: asset_name.into(),
            expected_size: Some(payload.len() as u64),
            sha256: hex.clone(),
            etag: None,
        };
        std::fs::write(&meta_path, serde_json::to_string(&stale_meta).unwrap()).unwrap();

        let sums_body = format!("{hex}  {asset_name}\n");
        let (url, mut rx) = serve(vec![
            ("200 OK", vec![], sums_body.into_bytes()),
            ("200 OK", vec![], payload.clone()),
        ])
        .await;
        let base = url.trim_end_matches('/');
        let target = DownloadTarget {
            tag: "v1.0.2".into(),
            asset_name: asset_name.into(),
            url: format!("{base}/asset"),
            sha256: hex,
            expected_size: Some(payload.len() as u64),
            sums_url: format!("{base}/SHA256SUMS.txt"),
        };
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let out = download_inner(&plain_client(), &dir, &target, cancel, &mut |_| {})
            .await
            .unwrap();
        assert!(out.ends_with(asset_name));
        assert_eq!(std::fs::read(dir.join(asset_name)).unwrap(), payload);
        // Stale partial was wiped before the GET (never Range-stitched).
        let _ = rx.recv().await;
        let _ = rx.recv().await;
        let _ = std::fs::remove_dir_all(&dir);
    }
}
