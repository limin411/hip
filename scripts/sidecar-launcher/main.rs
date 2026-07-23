//! Production sidecar launcher for macOS/Linux app bundles.
//!
//! Tauri's `externalBin` expects a single executable named `sidecar-<triple>`.
//! The real Node runtime + ncc-bundled JS live in `Contents/Resources/hip-sidecar/`.
//! This tiny binary `exec`s that Node with the bundled script, forwarding args and
//! stdio so Tauri can still `kill()` the process group cleanly.

use std::env;
use std::path::PathBuf;
use std::process::Command;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

fn runtime_dir(exe: &std::path::Path) -> PathBuf {
    if let Some(p) = env::var_os("HIP_SIDECAR_RUNTIME") {
        return PathBuf::from(p);
    }
    let macos_dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
    let candidates = [
        macos_dir.join("../Resources/hip-sidecar"),
        macos_dir.join("hip-sidecar"),
        macos_dir.join("../hip-sidecar"),
    ];
    for c in &candidates {
        if c.join("node").is_file() && c.join("index.js").is_file() {
            return c.clone();
        }
    }
    // Default: standard .app layout (even if not yet present — error below).
    macos_dir.join("../Resources/hip-sidecar")
}

fn main() {
    let exe = match env::current_exe() {
        Ok(p) => p.canonicalize().unwrap_or(p),
        Err(e) => {
            eprintln!("[sidecar-launcher] current_exe failed: {e}");
            std::process::exit(127);
        }
    };

    let runtime = runtime_dir(&exe);
    let node = runtime.join("node");
    let script = runtime.join("index.js");

    if !node.is_file() {
        eprintln!(
            "[sidecar-launcher] node runtime missing at {} (set HIP_SIDECAR_RUNTIME to override)",
            node.display()
        );
        std::process::exit(127);
    }
    if !script.is_file() {
        eprintln!(
            "[sidecar-launcher] index.js missing at {}",
            script.display()
        );
        std::process::exit(127);
    }

    let mut cmd = Command::new(&node);
    cmd.arg(&script);
    cmd.args(env::args().skip(1));
    // Optional native addons next to the script.
    if let Ok(prev) = env::var("PATH") {
        if let Some(dir) = script.parent() {
            cmd.env("PATH", format!("{}:{}", dir.display(), prev));
        }
    }

    #[cfg(unix)]
    {
        let err = cmd.exec();
        eprintln!("[sidecar-launcher] exec failed: {err}");
        std::process::exit(1);
    }

    #[cfg(not(unix))]
    {
        match cmd.status() {
            Ok(status) => std::process::exit(status.code().unwrap_or(1)),
            Err(e) => {
                eprintln!("[sidecar-launcher] spawn failed: {e}");
                std::process::exit(1);
            }
        }
    }
}
