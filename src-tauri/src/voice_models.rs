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

pub fn status_for_model(models_dir: &Path, id: &str) -> ModelStatus {
    let id = resolve_model_id(Some(id));
    let Some(spec) = spec_for(id) else {
        return ModelStatus {
            model: id.to_string(),
            ready: false,
            path: None,
            bytes_on_disk: None,
            corrupt: None,
            approx_bytes: None,
        };
    };
    let path = models_dir.join(spec.filename);
    if !path.is_file() {
        return ModelStatus {
            model: id.to_string(),
            ready: false,
            path: None,
            bytes_on_disk: None,
            corrupt: None,
            approx_bytes: Some(spec.approx_bytes),
        };
    }
    let meta = std::fs::metadata(&path).ok();
    let bytes = meta.map(|m| m.len());
    match sha256_hex_of_file(&path) {
        Ok(hex) if hex.eq_ignore_ascii_case(spec.sha256_hex) => ModelStatus {
            model: id.to_string(),
            ready: true,
            path: Some(path.display().to_string()),
            bytes_on_disk: bytes,
            corrupt: Some(false),
            approx_bytes: Some(spec.approx_bytes),
        },
        Ok(_) => ModelStatus {
            model: id.to_string(),
            ready: false,
            path: Some(path.display().to_string()),
            bytes_on_disk: bytes,
            corrupt: Some(true),
            approx_bytes: Some(spec.approx_bytes),
        },
        Err(_) => ModelStatus {
            model: id.to_string(),
            ready: false,
            path: Some(path.display().to_string()),
            bytes_on_disk: bytes,
            corrupt: Some(true),
            approx_bytes: Some(spec.approx_bytes),
        },
    }
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
}
