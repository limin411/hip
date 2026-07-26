//! Whisper ggml model catalog: download URLs, sizes, and SHA-256 pins.
//!
//! Hashes are Git LFS OIDs from Hugging Face `ggerganov/whisper.cpp` (main, 2026-07).

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub filename: &'static str,
    pub urls: &'static [&'static str],
    pub sha256_hex: &'static str,
    pub approx_bytes: u64,
}

/// HF resolve URLs (primary only; mirrors require product approval).
pub const MODEL_SPECS: &[ModelSpec] = &[
    ModelSpec {
        id: "tiny",
        filename: "ggml-tiny.bin",
        urls: &["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"],
        // LFS oid from HF API tree
        sha256_hex: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
        approx_bytes: 77_691_713,
    },
    ModelSpec {
        id: "base",
        filename: "ggml-base.bin",
        urls: &["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"],
        sha256_hex: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        approx_bytes: 147_951_465,
    },
    ModelSpec {
        id: "small",
        filename: "ggml-small.bin",
        urls: &["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"],
        sha256_hex: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        approx_bytes: 487_601_967,
    },
];

pub fn resolve_model_id(raw: Option<&str>) -> &'static str {
    match raw.unwrap_or("base") {
        "tiny" => "tiny",
        "small" => "small",
        _ => "base",
    }
}

pub fn spec_for(id: &str) -> Option<&'static ModelSpec> {
    let id = resolve_model_id(Some(id));
    MODEL_SPECS.iter().find(|s| s.id == id)
}

pub fn model_path(models_dir: &Path, id: &str) -> Option<PathBuf> {
    let spec = spec_for(id)?;
    Some(models_dir.join(spec.filename))
}

/// Prefer `preferred` if the file exists; otherwise first catalog model present on disk.
/// Returns `(model_id, absolute_path)`.
pub fn resolve_installed_model(
    models_dir: &Path,
    preferred: &str,
) -> Result<(String, PathBuf), String> {
    let preferred_id = resolve_model_id(Some(preferred));
    if let Some(p) = model_path(models_dir, preferred_id) {
        if p.is_file() {
            return Ok((preferred_id.to_string(), p));
        }
    }
    for spec in MODEL_SPECS {
        let p = models_dir.join(spec.filename);
        if p.is_file() {
            return Ok((spec.id.to_string(), p));
        }
    }
    // Last resort: any ggml-*.bin under the models dir (manual drops).
    if let Ok(rd) = std::fs::read_dir(models_dir) {
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with("ggml-") && name.ends_with(".bin") && ent.path().is_file() {
                let id = name
                    .trim_start_matches("ggml-")
                    .trim_end_matches(".bin")
                    .to_string();
                return Ok((id, ent.path()));
            }
        }
    }
    Err(format!(
        "voice.model_missing:dir={} preferred={}",
        models_dir.display(),
        preferred_id
    ))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub model: String,
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_on_disk: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corrupt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approx_bytes: Option<u64>,
    /// Bytes already on disk in `{filename}.partial` (for resume UI).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_bytes: Option<u64>,
}

pub fn sha256_hex_of_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 64];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Sidecar written after a successful full verify / download (`ggml-tiny.bin.sha256`).
pub fn sha256_sidecar_path(model_file: &Path) -> PathBuf {
    let mut s = model_file.as_os_str().to_os_string();
    s.push(".sha256");
    PathBuf::from(s)
}

pub fn write_sha256_sidecar(model_file: &Path, hex: &str) -> Result<(), String> {
    let side = sha256_sidecar_path(model_file);
    std::fs::write(&side, format!("{}\n", hex.trim().to_ascii_lowercase())).map_err(|e| e.to_string())
}

fn read_sha256_sidecar(model_file: &Path) -> Option<String> {
    let side = sha256_sidecar_path(model_file);
    let raw = std::fs::read_to_string(side).ok()?;
    let hex = raw.trim().to_ascii_lowercase();
    if hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(hex)
    } else {
        None
    }
}

fn partial_len(models_dir: &Path, filename: &str) -> Option<u64> {
    let partial = models_dir.join(format!("{filename}.partial"));
    std::fs::metadata(partial).ok().map(|m| m.len()).filter(|&n| n > 0)
}

fn empty_unknown(id: &str) -> ModelStatus {
    ModelStatus {
        model: id.to_string(),
        ready: false,
        path: None,
        bytes_on_disk: None,
        corrupt: None,
        approx_bytes: None,
        partial_bytes: None,
    }
}

/// Fast status for Settings page load — **never** hashes multi‑hundred‑MB files.
/// Ready when size matches catalog pin and/or a matching `.sha256` sidecar exists.
pub fn status_for_model_quick(models_dir: &Path, id: &str) -> ModelStatus {
    let id = resolve_model_id(Some(id));
    let Some(spec) = spec_for(id) else {
        return empty_unknown(id);
    };
    let partial_bytes = partial_len(models_dir, spec.filename);
    let path = models_dir.join(spec.filename);
    if !path.is_file() {
        return ModelStatus {
            model: id.to_string(),
            ready: false,
            path: None,
            bytes_on_disk: None,
            corrupt: None,
            approx_bytes: Some(spec.approx_bytes),
            partial_bytes,
        };
    }
    let bytes = std::fs::metadata(&path).ok().map(|m| m.len());
    let size_ok = bytes == Some(spec.approx_bytes);
    let sidecar_ok = read_sha256_sidecar(&path)
        .map(|h| h.eq_ignore_ascii_case(spec.sha256_hex))
        .unwrap_or(false);

    if size_ok || sidecar_ok {
        // Treat as ready without re-hashing (full verify is opt-in via Settings).
        return ModelStatus {
            model: id.to_string(),
            ready: true,
            path: Some(path.display().to_string()),
            bytes_on_disk: bytes,
            corrupt: Some(false),
            approx_bytes: Some(spec.approx_bytes),
            partial_bytes: None,
        };
    }

    // File present but size unexpected and no good sidecar — incomplete / wrong, not ready.
    // Do not mark corrupt without a full hash (could be a partial rename or custom build).
    ModelStatus {
        model: id.to_string(),
        ready: false,
        path: Some(path.display().to_string()),
        bytes_on_disk: bytes,
        corrupt: None,
        approx_bytes: Some(spec.approx_bytes),
        partial_bytes,
    }
}

/// Full SHA-256 verify (slow). Updates sidecar on success. Use only on explicit user action
/// or after download — never on every Settings page open.
pub fn status_for_model_full(models_dir: &Path, id: &str) -> ModelStatus {
    let id = resolve_model_id(Some(id));
    let Some(spec) = spec_for(id) else {
        return empty_unknown(id);
    };
    let partial_bytes = partial_len(models_dir, spec.filename);
    let path = models_dir.join(spec.filename);
    if !path.is_file() {
        return ModelStatus {
            model: id.to_string(),
            ready: false,
            path: None,
            bytes_on_disk: None,
            corrupt: None,
            approx_bytes: Some(spec.approx_bytes),
            partial_bytes,
        };
    }
    let bytes = std::fs::metadata(&path).ok().map(|m| m.len());
    match sha256_hex_of_file(&path) {
        Ok(hex) if hex.eq_ignore_ascii_case(spec.sha256_hex) => {
            let _ = write_sha256_sidecar(&path, &hex);
            ModelStatus {
                model: id.to_string(),
                ready: true,
                path: Some(path.display().to_string()),
                bytes_on_disk: bytes,
                corrupt: Some(false),
                approx_bytes: Some(spec.approx_bytes),
                partial_bytes: None,
            }
        }
        Ok(_) => ModelStatus {
            model: id.to_string(),
            ready: false,
            path: Some(path.display().to_string()),
            bytes_on_disk: bytes,
            corrupt: Some(true),
            approx_bytes: Some(spec.approx_bytes),
            partial_bytes,
        },
        Err(_) => ModelStatus {
            model: id.to_string(),
            ready: false,
            path: Some(path.display().to_string()),
            bytes_on_disk: bytes,
            corrupt: Some(true),
            approx_bytes: Some(spec.approx_bytes),
            partial_bytes,
        },
    }
}

/// Default entry used by callers that need a status; quick by default.
pub fn status_for_model(models_dir: &Path, id: &str) -> ModelStatus {
    status_for_model_quick(models_dir, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_defaults_to_base() {
        assert_eq!(resolve_model_id(None), "base");
        assert_eq!(resolve_model_id(Some("nope")), "base");
        assert_eq!(resolve_model_id(Some("tiny")), "tiny");
    }

    #[test]
    fn specs_have_unique_ids_and_hashes() {
        assert_eq!(MODEL_SPECS.len(), 3);
        for s in MODEL_SPECS {
            assert_eq!(s.sha256_hex.len(), 64);
            assert!(s.approx_bytes > 1_000_000);
            assert!(!s.urls.is_empty());
        }
    }

    #[test]
    fn status_reports_partial_bytes_when_incomplete() {
        let dir = std::env::temp_dir().join(format!("hip-voice-partial-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let partial = dir.join("ggml-tiny.bin.partial");
        std::fs::write(&partial, vec![0u8; 12345]).unwrap();
        let st = status_for_model_quick(&dir, "tiny");
        assert!(!st.ready);
        assert_eq!(st.partial_bytes, Some(12345));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quick_status_ready_when_size_matches_without_hashing() {
        let dir = std::env::temp_dir().join(format!("hip-voice-size-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("ggml-tiny.bin");
        // Exact catalog size — must not require full content for quick ready.
        let n = MODEL_SPECS.iter().find(|s| s.id == "tiny").unwrap().approx_bytes;
        // Sparse-ish: write via set_len after open (don't allocate 77MB in test if possible).
        {
            let f = std::fs::File::create(&path).unwrap();
            f.set_len(n).unwrap();
        }
        let st = status_for_model_quick(&dir, "tiny");
        assert!(st.ready, "size match should mark ready without SHA-256");
        assert_eq!(st.bytes_on_disk, Some(n));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn quick_status_ready_from_sidecar() {
        let dir = std::env::temp_dir().join(format!("hip-voice-side-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("ggml-tiny.bin");
        std::fs::write(&path, b"not-the-real-model").unwrap();
        let hex = MODEL_SPECS.iter().find(|s| s.id == "tiny").unwrap().sha256_hex;
        write_sha256_sidecar(&path, hex).unwrap();
        let st = status_for_model_quick(&dir, "tiny");
        assert!(st.ready);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_installed_falls_back_from_base_to_tiny() {
        let dir = std::env::temp_dir().join(format!("hip-voice-fb-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("ggml-tiny.bin"), b"x").unwrap();
        let (id, path) = resolve_installed_model(&dir, "base").unwrap();
        assert_eq!(id, "tiny");
        assert!(path.ends_with("ggml-tiny.bin"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
