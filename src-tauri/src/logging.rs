//! Rotating file logger under ~/.hip/logs.
use std::io::Write;
use std::sync::OnceLock;

const LOG_MAX_SIZE: u64 = 5 * 1024 * 1024; // 5 MB
const LOG_MAX_FILES: u32 = 5;

pub(crate) fn log_is_debug() -> bool {
    static V: OnceLock<bool> = OnceLock::new();
    *V.get_or_init(|| std::env::var("HIP_DEBUG").as_deref() == Ok("1"))
}

fn log_base_name() -> &'static str {
    if log_is_debug() { "tauri-debug" } else { "tauri" }
}

fn log_dir() -> &'static std::path::PathBuf {
    static V: OnceLock<std::path::PathBuf> = OnceLock::new();
    V.get_or_init(|| {
        let dir = dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(".hip").join("logs");
        let _ = std::fs::create_dir_all(&dir);
        dir
    })
}

fn log_file_path(suffix: &str) -> std::path::PathBuf {
    log_dir().join(format!("{}{}.log", log_base_name(), suffix))
}

fn log_rotate() {
    for i in (0..LOG_MAX_FILES).rev() {
        let suffix = if i == 0 { String::new() } else { format!(".{i}") };
        let src = log_file_path(&suffix);
        if !src.exists() { continue }
        if i >= LOG_MAX_FILES - 1 { let _ = std::fs::remove_file(&src); continue }
        let dst = log_file_path(&format!(".{}", i + 1));
        let _ = std::fs::rename(&src, &dst);
    }
}

pub(crate) fn log_write(level: &str, tag: &str, msg: &str) {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("[{ms}] [{level}] [{tag}] {msg}\n");
    let p = log_file_path("");
    if let Ok(meta) = std::fs::metadata(&p) {
        if meta.len() >= LOG_MAX_SIZE { log_rotate() }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = f.write_all(line.as_bytes());
    }
}

#[macro_export]
macro_rules! tauri_info {
    ($tag:expr, $msg:expr) => { $crate::logging::log_write("INFO", $tag, $msg) };
}
#[macro_export]
macro_rules! tauri_debug {
    ($tag:expr, $msg:expr) => { if $crate::logging::log_is_debug() { $crate::logging::log_write("DEBUG", $tag, $msg) } };
}

