//! Local voice dictation: whisper-cli spawn, model download, scratch WAV handling.

use crate::paths::{voice_scratch_dir, whisper_models_dir};
use crate::voice_models::{
    resolve_download_url, resolve_installed_model, resolve_model_id, sha256_hex_of_file, spec_for,
    status_for_model_full, status_for_model_quick, write_sha256_sidecar, ModelStatus,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Decoded WAV hard limit (4 MiB).
const MAX_WAV_BYTES: usize = 4 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(30);
/// Whole-request timeout (includes body). Large models on slow links need hours, not minutes.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(2 * 3600);
const DOWNLOAD_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT: &str = "hip-voice/1.0 (+local ASR model download)";

static TRANSCRIBE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CANCEL_FLAGS: OnceLock<Mutex<HashMap<String, AtomicBool>>> = OnceLock::new();

fn transcribe_lock() -> &'static Mutex<()> {
    TRANSCRIBE_LOCK.get_or_init(|| Mutex::new(()))
}

fn cancel_flags() -> &'static Mutex<HashMap<String, AtomicBool>> {
    CANCEL_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register an active download. Rejects if the same model is already downloading.
fn begin_download(id: &str) -> Result<(), String> {
    let mut map = cancel_flags().lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(id) {
        // false = still running; true = cancelled but not yet cleaned up
        if !flag.load(Ordering::SeqCst) {
            return Err("voice.download_in_progress".into());
        }
    }
    map.insert(id.to_string(), AtomicBool::new(false));
    Ok(())
}

fn end_download(id: &str) {
    if let Ok(mut map) = cancel_flags().lock() {
        map.remove(id);
    }
}

fn env_truthy(name: &str) -> bool {
    match std::env::var(name) {
        Ok(v) => {
            let t = v.trim();
            t == "1" || t.eq_ignore_ascii_case("true") || t.eq_ignore_ascii_case("yes")
        }
        Err(_) => false,
    }
}

fn env_disabled_voice() -> bool {
    match std::env::var("HIP_VOICE") {
        Ok(v) => {
            let t = v.trim();
            t == "0" || t.eq_ignore_ascii_case("false") || t.eq_ignore_ascii_case("off")
        }
        Err(_) => false,
    }
}

fn mock_mode() -> bool {
    env_truthy("HIP_VOICE_MOCK")
}

fn target_triple() -> String {
    // Injected by build.rs from Cargo TARGET.
    option_env!("TARGET")
        .map(str::to_string)
        .unwrap_or_else(|| "unknown-triple".into())
}

/// Candidate executable basenames (Homebrew formula may expose `whisper-cli` and/or `whisper-cpp`).
fn whisper_bin_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["whisper-cli.exe", "whisper-cpp.exe"]
    } else {
        &["whisper-cli", "whisper-cpp"]
    }
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
        return false;
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Shared libs that must be loadable next to (or under `../lib` of) whisper-cli.
///
/// Layouts we support:
/// - **Production (self-contained)**: `resources/whisper/<triple>/whisper-cli` + dylibs/DLLs
///   in the **same directory** (`@loader_path`) or `../lib` (`@loader_path/../lib`).
/// - **Homebrew bottle**: `…/opt/whisper-cpp/bin/whisper-cli` + `…/lib/libwhisper.*`.
/// - **Windows**: `whisper-cli.exe` + `*.dll` beside the exe (PE search path).
fn whisper_libs_resolvable(bin: &Path) -> bool {
    let real = std::fs::canonicalize(bin).unwrap_or_else(|_| bin.to_path_buf());
    let Some(parent) = real.parent() else {
        return false;
    };

    #[cfg(windows)]
    {
        // On Windows a standalone build is often fully static or loads DLLs from the
        // same directory. Accept exe if it exists; also accept when whisper*.dll is present.
        let dll_hints = ["whisper.dll", "libwhisper.dll", "ggml.dll", "libggml.dll"];
        if dll_hints.iter().any(|n| parent.join(n).is_file()) {
            return true;
        }
        // No adjacent DLL → assume static / system PATH; still usable.
        return true;
    }

    #[cfg(not(windows))]
    {
        let lib_names = [
            "libwhisper.1.dylib",
            "libwhisper.dylib",
            "libwhisper.so.1",
            "libwhisper.so",
        ];
        for name in lib_names {
            if parent.join(name).is_file() {
                return true;
            }
            if parent.join("lib").join(name).is_file() {
                return true;
            }
            if parent.join("../lib").join(name).is_file() {
                return true;
            }
            // …/bin/whisper-cli → …/lib/libwhisper (Homebrew prefix layout)
            if parent.file_name().is_some_and(|n| n == "bin") {
                if let Some(prefix) = parent.parent() {
                    if prefix.join("lib").join(name).is_file() {
                        return true;
                    }
                }
            }
        }
        false
    }
}

fn finalize_bin_path(path: PathBuf) -> PathBuf {
    std::fs::canonicalize(&path).unwrap_or(path)
}

fn push_if_exe(out: &mut Vec<PathBuf>, p: PathBuf) {
    if is_executable_file(&p) {
        out.push(p);
    }
}

/// Resolve whisper-cli for three product scenarios:
///
/// | Scenario | Preferred source |
/// |----------|------------------|
/// | **macOS / Windows production** (packaged app) | App `resources/whisper/<triple>/` self-contained tree |
/// | **Development** (tauri dev) | `HIP_WHISPER_BIN` → system Homebrew/PATH → staged resources → `~/.hip/bin` |
/// | **Override** | `HIP_WHISPER_BIN` always wins when set and executable |
///
/// Orphan copies of brew bottles into `~/.hip/bin` **without** libs are skipped
/// (they fail with `libwhisper.1.dylib (no such file)`).
pub fn resolve_whisper_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HIP_WHISPER_BIN") {
        let path = PathBuf::from(p);
        if is_executable_file(&path) {
            return Some(finalize_bin_path(path));
        }
    }

    let names = whisper_bin_names();
    // Tier A: self-contained or known-good system installs (safe for production + dev).
    let mut tier_a: Vec<PathBuf> = Vec::new();
    // Tier B: may need DYLD_FALLBACK (dev only; often broken).
    let mut tier_b: Vec<PathBuf> = Vec::new();

    // --- Production: bundled resources first (no Homebrew on end-user machines) ---
    if let Ok(resource_dir) = app.path().resource_dir() {
        let triple = target_triple();
        for n in names {
            push_if_exe(
                &mut tier_a,
                resource_dir.join("whisper").join(&triple).join(n),
            );
            push_if_exe(&mut tier_a, resource_dir.join("whisper").join(n));
        }
    }

    // --- Dev / optional system engines ---
    #[cfg(target_os = "macos")]
    {
        for prefix in [
            "/opt/homebrew/opt/whisper-cpp/bin",
            "/usr/local/opt/whisper-cpp/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ] {
            for n in names {
                push_if_exe(&mut tier_a, PathBuf::from(prefix).join(n));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        for prefix in ["/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"] {
            for n in names {
                push_if_exe(&mut tier_a, PathBuf::from(prefix).join(n));
            }
        }
    }
    #[cfg(windows)]
    {
        // Common optional locations for a user-built or package-managed CLI.
        if let Some(home) = dirs::home_dir() {
            for n in names {
                push_if_exe(&mut tier_a, home.join(".hip").join("bin").join(n));
            }
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            for n in names {
                push_if_exe(&mut tier_a, PathBuf::from(&pf).join("whisper-cpp").join(n));
                push_if_exe(&mut tier_a, PathBuf::from(&pf).join("hip").join("bin").join(n));
            }
        }
    }

    // User-local install (macOS/Linux). Prefer only when libs resolve.
    #[cfg(not(windows))]
    if let Some(home) = dirs::home_dir() {
        let hip_bin = home.join(".hip").join("bin");
        for n in names {
            let p = hip_bin.join(n);
            if is_executable_file(&p) {
                if whisper_libs_resolvable(&p) {
                    tier_a.push(p);
                } else {
                    tier_b.push(p);
                }
            }
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            for n in names {
                let p = dir.join(n);
                if !is_executable_file(&p) {
                    continue;
                }
                if whisper_libs_resolvable(&p) {
                    tier_a.push(p);
                } else {
                    tier_b.push(p);
                }
            }
        }
    }

    // Pick first resolvable path.
    for p in &tier_a {
        if whisper_libs_resolvable(p) {
            return Some(finalize_bin_path(p.clone()));
        }
    }
    // Production Windows static builds: tier_a entries with no DLL still OK.
    #[cfg(windows)]
    {
        if let Some(p) = tier_a.into_iter().next() {
            return Some(finalize_bin_path(p));
        }
    }
    // Dev last resort: brew opt even if resolvable check failed, then tier_b with env injection.
    #[cfg(target_os = "macos")]
    {
        for prefix in ["/opt/homebrew/opt/whisper-cpp/bin", "/usr/local/opt/whisper-cpp/bin"] {
            for n in names {
                let p = PathBuf::from(prefix).join(n);
                if is_executable_file(&p) {
                    return Some(finalize_bin_path(p));
                }
            }
        }
    }
    for p in tier_b {
        if is_executable_file(&p) {
            return Some(finalize_bin_path(p));
        }
    }
    None
}

fn cleanup_stale_scratch(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now() - Duration::from_secs(3600);
    for ent in rd.flatten() {
        let path = ent.path();
        let name = ent.file_name().to_string_lossy().to_string();
        if name.ends_with(".partial") {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        if let Ok(meta) = ent.metadata() {
            if let Ok(mtime) = meta.modified() {
                if mtime < cutoff {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRuntimeStatus {
    pub mock: bool,
    pub binary_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    pub voice_env_disabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatusArgs {
    pub model: Option<String>,
    /// When true, full SHA-256 (slow). Default false — size/sidecar only (Settings open must not freeze).
    #[serde(default)]
    pub verify: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadModelArgs {
    pub model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeArgs {
    pub wav_base64: String,
    pub language: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub text: String,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_ms: Option<u64>,
    pub model: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub phase: String,
}

#[tauri::command]
pub fn voice_runtime_status(app: AppHandle) -> VoiceRuntimeStatus {
    let bin = resolve_whisper_binary(&app);
    VoiceRuntimeStatus {
        mock: mock_mode(),
        binary_available: bin.is_some() || mock_mode(),
        binary_path: bin.map(|p| p.display().to_string()),
        voice_env_disabled: env_disabled_voice(),
    }
}

#[tauri::command]
pub async fn voice_model_status(
    app: AppHandle,
    args: ModelStatusArgs,
) -> Result<ModelStatus, String> {
    let dir = whisper_models_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
    let id = resolve_model_id(args.model.as_deref()).to_string();
    let verify = args.verify.unwrap_or(false);
    // Full hash of 100–500 MB models on the async runtime freezes the UI — offload.
    tauri::async_runtime::spawn_blocking(move || {
        if verify {
            status_for_model_full(&dir, &id)
        } else {
            status_for_model_quick(&dir, &id)
        }
    })
    .await
    .map_err(|e| format!("voice.status_join:{e}"))
}

#[tauri::command]
pub fn voice_open_models_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = whisper_models_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("voice.open_failed:{e}"))
}

#[tauri::command]
pub fn voice_cancel_download(args: DownloadModelArgs) -> Result<(), String> {
    let id = resolve_model_id(args.model.as_deref()).to_string();
    let map = cancel_flags().lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_download_model(
    app: AppHandle,
    args: DownloadModelArgs,
) -> Result<serde_json::Value, String> {
    let id = resolve_model_id(args.model.as_deref()).to_string();
    let spec = spec_for(&id).ok_or_else(|| "voice.unknown_model".to_string())?;
    let models_dir =
        whisper_models_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
    let dest = models_dir.join(spec.filename);
    if dest.is_file() {
        // Prefer sidecar / catalog size before full hash (full hash freezes UI on large models).
        let size_ok = std::fs::metadata(&dest)
            .map(|m| m.len() == spec.approx_bytes)
            .unwrap_or(false);
        let side = crate::voice_models::sha256_sidecar_path(&dest);
        let side_ok = std::fs::read_to_string(&side)
            .ok()
            .map(|s| s.trim().eq_ignore_ascii_case(spec.sha256_hex))
            .unwrap_or(false);
        if size_ok || side_ok {
            return Ok(serde_json::json!({ "path": dest.display().to_string() }));
        }
        // Unexpected size: one full verify, then accept or wipe.
        if let Ok(hex) = sha256_hex_of_file(&dest) {
            if hex.eq_ignore_ascii_case(spec.sha256_hex) {
                let _ = write_sha256_sidecar(&dest, &hex);
                return Ok(serde_json::json!({ "path": dest.display().to_string() }));
            }
        }
        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(&side);
    }

    // Reject concurrent same-model downloads (second start would truncate .partial
    // and make progress events thrash between two writers).
    begin_download(&id)?;

    let result = download_model_body(app, &id, spec, &models_dir, &dest).await;
    end_download(&id);
    result
}

/// Parse `Content-Range: bytes start-end/total` → total size.
fn parse_content_range_total(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let cr = headers.get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    // e.g. "bytes 1000-2000/77691713" or "bytes 1000-2000/*"
    let total = cr.rsplit('/').next()?;
    if total == "*" {
        return None;
    }
    total.parse().ok()
}

fn emit_progress(app: &AppHandle, id: &str, downloaded: u64, total: Option<u64>, phase: &str) {
    let _ = app.emit(
        "voice://download-progress",
        DownloadProgress {
            model: id.to_string(),
            downloaded,
            total,
            phase: phase.into(),
        },
    );
}

fn is_cancelled(id: &str) -> bool {
    cancel_flags()
        .lock()
        .ok()
        .and_then(|m| m.get(id).map(|f| f.load(Ordering::SeqCst)))
        .unwrap_or(false)
}

/// Verify partial → rename to dest. Keeps partial on incomplete; deletes only on hash mismatch
/// of a full-size file.
fn finalize_partial(
    app: &AppHandle,
    id: &str,
    spec: &crate::voice_models::ModelSpec,
    partial: &Path,
    dest: &Path,
    downloaded: u64,
    total: Option<u64>,
) -> Result<serde_json::Value, String> {
    emit_progress(app, id, downloaded, total.or(Some(spec.approx_bytes)), "hashing");

    // Incomplete stream: keep .partial so the next attempt can Range-resume.
    if let Some(t) = total {
        if downloaded < t {
            return Err(format!("voice.download_incomplete:{downloaded}/{t}"));
        }
    } else if downloaded + 4096 < spec.approx_bytes {
        return Err(format!(
            "voice.download_incomplete:{downloaded}/{}",
            spec.approx_bytes
        ));
    }

    let hex = sha256_hex_of_file(partial)?;
    if !hex.eq_ignore_ascii_case(spec.sha256_hex) {
        // Full-size (or near) but wrong bytes → corrupt; drop partial so we do not loop forever.
        let _ = std::fs::remove_file(partial);
        return Err("voice.download_hash_mismatch".into());
    }
    std::fs::rename(partial, dest).map_err(|e| e.to_string())?;
    // Sidecar lets later Settings opens mark ready without re-hashing hundreds of MB.
    let _ = write_sha256_sidecar(dest, &hex);
    emit_progress(
        app,
        id,
        downloaded,
        total.or(Some(spec.approx_bytes)),
        "ready",
    );
    Ok(serde_json::json!({ "path": dest.display().to_string() }))
}

/// Build a download client that honors `[proxy]` when enabled (else env proxies).
fn download_http_client(app: &AppHandle) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(DOWNLOAD_CONNECT_TIMEOUT)
        .timeout(DOWNLOAD_TIMEOUT);
    if let Ok(cfg) = crate::hip_config::load_hip_config(app) {
        if let Some(proxy) = cfg.proxy {
            if proxy.enabled == Some(true) {
                // Prefer https → http → all for HTTPS model downloads.
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
    builder.build().map_err(|e| format!("voice.network:{e}"))
}

/// Optional URL override from `[voice.model_urls]` for this model id.
fn voice_model_url_override(app: &AppHandle, id: &str) -> Option<String> {
    let cfg = crate::hip_config::load_hip_config(app).ok()?;
    let urls = cfg.voice?.model_urls?;
    let raw = urls.get(id)?.trim();
    if raw.is_empty() {
        None
    } else {
        Some(raw.to_string())
    }
}

async fn download_model_body(
    app: AppHandle,
    id: &str,
    spec: &crate::voice_models::ModelSpec,
    models_dir: &Path,
    dest: &Path,
) -> Result<serde_json::Value, String> {
    let partial = models_dir.join(format!("{}.partial", spec.filename));
    let expected = spec.approx_bytes;

    // Resume: keep existing .partial (previous versions wiped it every start).
    let mut downloaded: u64 = if partial.is_file() {
        std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    // Obviously corrupt / runaway partial → restart.
    if downloaded > expected.saturating_add(1024 * 1024) {
        let _ = std::fs::remove_file(&partial);
        downloaded = 0;
    }

    // Partial already full catalog size: skip network and verify.
    if downloaded > 0 && downloaded == expected {
        return finalize_partial(&app, id, spec, &partial, dest, downloaded, Some(expected));
    }

    let client = download_http_client(&app)?;

    let override_url = voice_model_url_override(&app, id);
    let url = resolve_download_url(id, override_url.as_deref())
        .ok_or_else(|| "voice.unknown_model".to_string())?;
    let mut req = client.get(&url);
    if downloaded > 0 {
        req = req.header(
            reqwest::header::RANGE,
            format!("bytes={downloaded}-"),
        );
    }

    if downloaded > 0 {
        emit_progress(&app, id, downloaded, Some(expected), "downloading");
    }

    let mut resp = req.send().await.map_err(|e| format!("voice.network:{e}"))?;
    let status = resp.status();

    let total: Option<u64>;
    let mut file: std::fs::File;

    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        // 206 — server accepted Range; append to partial.
        total = parse_content_range_total(resp.headers())
            .or_else(|| resp.content_length().map(|n| downloaded + n))
            .or(Some(expected));
        file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial)
            .map_err(|e| e.to_string())?;
    } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        // 416 — often means local partial is already complete (or past EOF).
        drop(resp);
        if partial.is_file() {
            downloaded = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(downloaded);
            return finalize_partial(&app, id, spec, &partial, dest, downloaded, Some(expected));
        }
        return Err("voice.http_status:416".into());
    } else if status.is_success() {
        // 200 — full body (fresh download, or server ignored Range).
        if downloaded > 0 {
            // Cannot append a full body onto a partial; restart cleanly.
            let _ = std::fs::remove_file(&partial);
            downloaded = 0;
        }
        total = resp.content_length().or(Some(expected));
        file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    } else {
        return Err(format!("voice.http_status:{}", status.as_u16()));
    }

    emit_progress(&app, id, downloaded, total, "downloading");

    let mut since_flush: u64 = 0;
    loop {
        if is_cancelled(id) {
            // Keep .partial so the next click can resume (Range).
            let _ = file.flush();
            return Err("voice.cancelled".into());
        }
        let chunk = match resp.chunk().await {
            Ok(c) => c,
            Err(e) => {
                let _ = file.flush();
                // Keep .partial for resume.
                return Err(format!("voice.network:{e}"));
            }
        };
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let n = chunk.len() as u64;
        downloaded += n;
        since_flush += n;
        if since_flush >= 1024 * 1024 {
            let _ = file.flush();
            since_flush = 0;
        }
        emit_progress(&app, id, downloaded, total, "downloading");
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    finalize_partial(&app, id, spec, &partial, dest, downloaded, total)
}

fn decode_wav_base64(b64: &str) -> Result<Vec<u8>, String> {
    let s = b64.trim();
    // Reject data-URL prefix
    if s.starts_with("data:") {
        return Err("voice.invalid_payload".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| "voice.invalid_payload".to_string())?;
    if bytes.len() > MAX_WAV_BYTES {
        return Err("voice.payload_too_large".into());
    }
    if bytes.len() < 44 {
        return Err("voice.invalid_wav".into());
    }
    Ok(bytes)
}

fn estimate_audio_ms(wav: &[u8]) -> Option<u64> {
    // PCM 16-bit mono 16 kHz: data size after 44-byte header
    if wav.len() <= 44 {
        return None;
    }
    let data_len = (wav.len() - 44) as u64;
    // 16000 samples/s * 2 bytes
    Some(data_len * 1000 / 32_000)
}

/// Process environment for spawning whisper-cli across scenarios.
///
/// - **Production (mac/win)**: primarily relies on self-contained layout (same-dir libs /
///   correct rpath). Env only augments PATH.
/// - **Dev (macOS)**: may inject `DYLD_FALLBACK_LIBRARY_PATH` for Homebrew libs when an
///   orphan copy is used. Hardened Runtime on signed release builds can strip DYLD_*;
///   that is why release packaging must ship a self-contained tree.
fn whisper_command_env(cmd: &mut Command, bin: &Path) {
    let mut path = std::env::var("PATH").unwrap_or_default();
    #[cfg(windows)]
    {
        let sep = ';';
        for prefix in [
            r"C:\Program Files\whisper-cpp",
            r"C:\Program Files\hip\bin",
        ] {
            if !path.split(sep).any(|p| p.eq_ignore_ascii_case(prefix)) {
                path = if path.is_empty() {
                    prefix.to_string()
                } else {
                    format!("{prefix}{sep}{path}")
                };
            }
        }
        // Ensure the directory of the exe is on PATH so adjacent DLLs resolve.
        if let Ok(real) = std::fs::canonicalize(bin) {
            if let Some(parent) = real.parent() {
                let p = parent.display().to_string();
                if !path.split(sep).any(|x| x.eq_ignore_ascii_case(&p)) {
                    path = if path.is_empty() {
                        p
                    } else {
                        format!("{p}{sep}{path}")
                    };
                }
            }
        }
        cmd.env("PATH", path);
        return;
    }

    #[cfg(not(windows))]
    {
        for prefix in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ] {
            if !path.split(':').any(|p| p == prefix) {
                path = if path.is_empty() {
                    prefix.to_string()
                } else {
                    format!("{prefix}:{path}")
                };
            }
        }
        cmd.env("PATH", &path);

        let mut lib_dirs: Vec<PathBuf> = Vec::new();
        let real = std::fs::canonicalize(bin).unwrap_or_else(|_| bin.to_path_buf());
        if let Some(parent) = real.parent() {
            lib_dirs.push(parent.to_path_buf());
            lib_dirs.push(parent.join("lib"));
            lib_dirs.push(parent.join("../lib"));
            if parent.file_name().is_some_and(|n| n == "bin") {
                if let Some(prefix) = parent.parent() {
                    lib_dirs.push(prefix.join("lib"));
                }
            }
        }
        for p in [
            "/opt/homebrew/opt/whisper-cpp/lib",
            "/opt/homebrew/opt/ggml/lib",
            "/opt/homebrew/lib",
            "/usr/local/opt/whisper-cpp/lib",
            "/usr/local/opt/ggml/lib",
            "/usr/local/lib",
        ] {
            lib_dirs.push(PathBuf::from(p));
        }
        let lib_path = lib_dirs
            .into_iter()
            .filter(|p| p.is_dir())
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(":");
        if !lib_path.is_empty() {
            let merged = match std::env::var("DYLD_FALLBACK_LIBRARY_PATH") {
                Ok(existing) if !existing.is_empty() => format!("{lib_path}:{existing}"),
                _ => lib_path.clone(),
            };
            cmd.env("DYLD_FALLBACK_LIBRARY_PATH", &merged);
            // Also set Linux-style for cross-compile / rare linux builds of the shell.
            #[cfg(target_os = "linux")]
            {
                let merged_ld = match std::env::var("LD_LIBRARY_PATH") {
                    Ok(existing) if !existing.is_empty() => format!("{lib_path}:{existing}"),
                    _ => lib_path.clone(),
                };
                cmd.env("LD_LIBRARY_PATH", merged_ld);
            }
            #[cfg(target_os = "macos")]
            cmd.env("DYLD_LIBRARY_PATH", &merged);
        }
    }
}

fn run_whisper_cli(
    bin: &Path,
    model: &Path,
    wav: &Path,
    language: &str,
) -> Result<String, String> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    // Prefer long form flags; brew whisper-cli 1.9 accepts both.
    let mut cmd = Command::new(bin);
    whisper_command_env(&mut cmd, bin);
    let mut child = cmd
        .args([
            "-m",
            &model.display().to_string(),
            "-f",
            &wav.display().to_string(),
            "-l",
            language,
            "-nt",
            "-np",
            "-t",
            &threads.to_string(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("voice.spawn_failed:{e}"))?;

    let start = Instant::now();
    loop {
        if start.elapsed() > TRANSCRIBE_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("voice.timeout".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut stdout);
                }
                let mut stderr = String::new();
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut stderr);
                }
                if !status.success() {
                    let tail: String = stderr
                        .chars()
                        .rev()
                        .take(240)
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                    eprintln!(
                        "[tauri] whisper-cli failed status={status:?} bin={} model={} wav={} stderr_tail={}",
                        bin.display(),
                        model.display(),
                        wav.display(),
                        tail
                    );
                    let lower = stderr.to_ascii_lowercase();
                    // Only treat as missing model when the model path itself is implicated —
                    // metal/dylib "failed to open" must NOT map to model_missing.
                    let model_name = model
                        .file_name()
                        .map(|s| s.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    if (!model_name.is_empty() && lower.contains(&model_name) && lower.contains("fail"))
                        || lower.contains("failed to load model")
                        || lower.contains("invalid model file")
                        || lower.contains("error loading model")
                    {
                        return Err(format!(
                            "voice.model_missing:path={}",
                            model.display()
                        ));
                    }
                    return Err(format!("voice.transcribe_failed:{}", tail.replace('\n', " ")));
                }
                // whisper-cli may print backend noise on stderr; text is on stdout (with -np).
                let text = stdout
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty())
                    .filter(|l| {
                        // Drop accidental log lines if -np was ignored.
                        !l.starts_with("whisper_")
                            && !l.starts_with("ggml_")
                            && !l.starts_with("system_info")
                            && !l.starts_with("main:")
                    })
                    .collect::<Vec<_>>()
                    .join(" ")
                    .trim()
                    .to_string();
                return Ok(text);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("voice.transcribe_failed:{e}")),
        }
    }
}

#[tauri::command]
pub async fn voice_transcribe(
    app: AppHandle,
    args: TranscribeArgs,
) -> Result<TranscribeResult, String> {
    if env_disabled_voice() {
        return Err("voice.disabled".into());
    }

    // Offload CLI spawn so the UI thread does not freeze during Metal/CPU load.
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = transcribe_lock()
            .lock()
            .map_err(|_| "voice.busy".to_string())?;

        let t0 = Instant::now();
        let model_id = resolve_model_id(args.model.as_deref()).to_string();
        let language = args
            .language
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("auto");

        if mock_mode() {
            return Ok(TranscribeResult {
                text: "hello from voice mock".into(),
                duration_ms: t0.elapsed().as_millis() as u64,
                audio_ms: None,
                model: model_id,
            });
        }

        let wav_bytes = decode_wav_base64(&args.wav_base64)?;
        let audio_ms = estimate_audio_ms(&wav_bytes);
        let scratch =
            voice_scratch_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
        cleanup_stale_scratch(&scratch);

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let wav_path = scratch.join(format!("rec-{stamp}.wav"));
        std::fs::write(&wav_path, &wav_bytes).map_err(|e| e.to_string())?;
        drop(wav_bytes);

        let models_dir =
            whisper_models_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
        let (used_model, model_file) = match resolve_installed_model(&models_dir, &model_id) {
            Ok(v) => v,
            Err(e) => {
                let _ = std::fs::remove_file(&wav_path);
                return Err(e);
            }
        };

        let bin = resolve_whisper_binary(&app);
        let result = match bin {
            Some(bin) => {
                eprintln!(
                    "[tauri] voice_transcribe bin={} model={} wav={} lang={}",
                    bin.display(),
                    model_file.display(),
                    wav_path.display(),
                    language
                );
                run_whisper_cli(&bin, &model_file, &wav_path, language)
            }
            None => Err("voice.binary_missing".into()),
        };

        let _ = std::fs::remove_file(&wav_path);
        let text = result?;
        Ok(TranscribeResult {
            text,
            duration_ms: t0.elapsed().as_millis() as u64,
            audio_ms,
            model: used_model,
        })
    })
    .await
    .map_err(|e| format!("voice.transcribe_join:{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue, CONTENT_RANGE};

    #[test]
    fn rejects_oversized_payload() {
        let big = vec![0u8; MAX_WAV_BYTES + 1];
        let b64 = base64::engine::general_purpose::STANDARD.encode(&big);
        assert_eq!(decode_wav_base64(&b64).unwrap_err(), "voice.payload_too_large");
    }

    #[test]
    fn rejects_data_url() {
        assert_eq!(
            decode_wav_base64("data:audio/wav;base64,AAAA").unwrap_err(),
            "voice.invalid_payload"
        );
    }

    #[test]
    fn parses_content_range_total() {
        let mut h = HeaderMap::new();
        h.insert(
            CONTENT_RANGE,
            HeaderValue::from_static("bytes 1000-2000/77691713"),
        );
        assert_eq!(parse_content_range_total(&h), Some(77_691_713));
        let mut h2 = HeaderMap::new();
        h2.insert(CONTENT_RANGE, HeaderValue::from_static("bytes 0-99/*"));
        assert_eq!(parse_content_range_total(&h2), None);
    }
}
