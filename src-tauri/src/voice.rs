//! Local voice dictation: whisper-cli spawn, model download, scratch WAV handling.

use crate::paths::{voice_scratch_dir, whisper_models_dir};
use crate::voice_models::{
    model_path, resolve_model_id, sha256_hex_of_file, spec_for, status_for_model, ModelStatus,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
const USER_AGENT: &str = "hip-voice/1.0 (+local ASR model download)";

static TRANSCRIBE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CANCEL_FLAGS: OnceLock<Mutex<HashMap<String, AtomicBool>>> = OnceLock::new();

fn transcribe_lock() -> &'static Mutex<()> {
    TRANSCRIBE_LOCK.get_or_init(|| Mutex::new(()))
}

fn cancel_flags() -> &'static Mutex<HashMap<String, AtomicBool>> {
    CANCEL_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
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

fn whisper_bin_name() -> &'static str {
    if cfg!(windows) {
        "whisper-cli.exe"
    } else {
        "whisper-cli"
    }
}

/// Resolve whisper-cli path: HIP_WHISPER_BIN → resources/whisper/<triple>/ → resources/whisper/.
pub fn resolve_whisper_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HIP_WHISPER_BIN") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }
    let resource_dir = app.path().resource_dir().ok()?;
    let name = whisper_bin_name();
    let triple = target_triple();
    let candidates = [
        resource_dir.join("whisper").join(&triple).join(name),
        resource_dir.join("whisper").join(name),
    ];
    candidates.into_iter().find(|p| p.is_file())
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
pub fn voice_model_status(app: AppHandle, args: ModelStatusArgs) -> Result<ModelStatus, String> {
    let dir = whisper_models_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
    let id = resolve_model_id(args.model.as_deref());
    Ok(status_for_model(&dir, id))
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
        if let Ok(hex) = sha256_hex_of_file(&dest) {
            if hex.eq_ignore_ascii_case(spec.sha256_hex) {
                return Ok(serde_json::json!({ "path": dest.display().to_string() }));
            }
        }
        let _ = std::fs::remove_file(&dest);
    }

    {
        let mut map = cancel_flags().lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), AtomicBool::new(false));
    }

    let partial = models_dir.join(format!("{}.partial", spec.filename));
    let _ = std::fs::remove_file(&partial);

    let url = spec.urls[0];
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("voice.network:{e}"))?;

    let mut resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("voice.network:{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("voice.http_status:{}", resp.status().as_u16()));
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    loop {
        if cancel_flags()
            .lock()
            .ok()
            .and_then(|m| m.get(&id).map(|f| f.load(Ordering::SeqCst)))
            .unwrap_or(false)
        {
            let _ = std::fs::remove_file(&partial);
            return Err("voice.cancelled".into());
        }
        let chunk = resp
            .chunk()
            .await
            .map_err(|e| format!("voice.network:{e}"))?;
        let Some(chunk) = chunk else { break };
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "voice://download-progress",
            DownloadProgress {
                model: id.clone(),
                downloaded,
                total,
                phase: "downloading".into(),
            },
        );
    }
    drop(file);

    let _ = app.emit(
        "voice://download-progress",
        DownloadProgress {
            model: id.clone(),
            downloaded,
            total,
            phase: "hashing".into(),
        },
    );

    let hex = sha256_hex_of_file(&partial)?;
    if !hex.eq_ignore_ascii_case(spec.sha256_hex) {
        let _ = std::fs::remove_file(&partial);
        return Err("voice.download_hash_mismatch".into());
    }
    std::fs::rename(&partial, &dest).map_err(|e| e.to_string())?;
    let _ = app.emit(
        "voice://download-progress",
        DownloadProgress {
            model: id.clone(),
            downloaded,
            total,
            phase: "ready".into(),
        },
    );
    Ok(serde_json::json!({ "path": dest.display().to_string() }))
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

fn run_whisper_cli(
    bin: &Path,
    model: &Path,
    wav: &Path,
    language: &str,
) -> Result<String, String> {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let mut child = Command::new(bin)
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
                    let tail: String = stderr.chars().rev().take(200).collect::<String>().chars().rev().collect();
                    eprintln!(
                        "[tauri] whisper-cli failed status={status:?} stderr_len={} tail={}",
                        stderr.len(),
                        tail
                    );
                    return Err("voice.transcribe_failed".into());
                }
                let text = stdout
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty())
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
pub fn voice_transcribe(app: AppHandle, args: TranscribeArgs) -> Result<TranscribeResult, String> {
    if env_disabled_voice() {
        return Err("voice.disabled".into());
    }
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
    let scratch = voice_scratch_dir(&app).ok_or_else(|| "voice.paths_unavailable".to_string())?;
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
    let model_file =
        model_path(&models_dir, &model_id).ok_or_else(|| "voice.unknown_model".to_string())?;
    if !model_file.is_file() {
        let _ = std::fs::remove_file(&wav_path);
        return Err("voice.model_missing".into());
    }

    let bin = resolve_whisper_binary(&app);
    let result = match bin {
        Some(bin) => run_whisper_cli(&bin, &model_file, &wav_path, language),
        None => Err("voice.binary_missing".into()),
    };

    let _ = std::fs::remove_file(&wav_path);
    let text = result?;
    Ok(TranscribeResult {
        text,
        duration_ms: t0.elapsed().as_millis() as u64,
        audio_ms,
        model: model_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
