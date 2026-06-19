//! Make the app see the user's REAL global PATH.
//!
//! A macOS app launched from Finder/Dock/an IDE inherits a minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) — NOT the user's interactive shell PATH. Tools
//! installed in user dirs (`~/.npm-global/bin`, `/opt/homebrew/bin`, version-manager
//! dirs, …) are then invisible. We fix this once at startup so detection
//! (`which_binaries`), the sidecar, and every spawned ACP/CLI agent all see the same,
//! correct global PATH.

use std::collections::HashSet;
use std::time::{Duration, Instant};

/// Merge PATH-like strings into one: preserve first-seen order, dedup, drop empty
/// segments. Pure — unit-tested.
pub fn merge_paths(parts: &[String]) -> String {
    let mut seen = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for part in parts {
        for d in part.split(':') {
            if !d.is_empty() && seen.insert(d.to_string()) {
                out.push(d.to_string());
            }
        }
    }
    out.join(":")
}

/// Common global bin dirs where user-installed CLIs land regardless of installer
/// (npm -g, Homebrew, cargo, pnpm, …). A safe baseline so a GUI-stripped PATH still
/// finds globally-installed tools even when the login-shell probe is unavailable.
fn common_dirs() -> String {
    let mut dirs = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    if let Ok(home) = std::env::var("HOME") {
        for sub in [
            ".npm-global/bin",
            ".local/bin",
            ".cargo/bin",
            ".bun/bin",
            ".deno/bin",
            "Library/pnpm",
            ".volta/bin",
            ".yarn/bin",
        ] {
            dirs.push(format!("{home}/{sub}"));
        }
    }
    dirs.join(":")
}

/// Best-effort: capture the PATH of the user's interactive login shell (covers version
/// managers like nvm/fnm/rbenv that only mutate PATH in shell rc files). Returns None on
/// any failure or if it exceeds a short timeout. macOS/Linux only.
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    if shell.is_empty() {
        return None;
    }
    const MARK: &str = "__HIP_PATH__";
    let mut child = std::process::Command::new(&shell)
        .args(["-lic", &format!("printf '{MARK}%s' \"$PATH\"")])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_millis(2500);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return None,
        }
    }
    let out = child.wait_with_output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let idx = s.rfind(MARK)?;
    let path = s[idx + MARK.len()..].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// Resolve a robust PATH (login-shell ∪ current ∪ common dirs) and apply it to this
/// process, so detection, the sidecar, and every spawned agent see the user's real
/// global PATH instead of the stripped PATH a GUI-launched macOS app inherits.
pub fn ensure_user_path() {
    let current = std::env::var("PATH").unwrap_or_default();
    let login = login_shell_path().unwrap_or_default();
    // login first (the user's authoritative PATH), then current, then the common baseline.
    let merged = merge_paths(&[login, current, common_dirs()]);
    if !merged.is_empty() {
        std::env::set_var("PATH", merged);
    }
}

#[cfg(test)]
mod tests {
    use super::merge_paths;

    #[test]
    fn merge_paths_dedups_preserves_order_drops_empty() {
        let got = merge_paths(&[
            "/a:/b".to_string(),
            "/b:/c".to_string(),
            "/a".to_string(),
            String::new(),
            "/x::/y".to_string(),
        ]);
        assert_eq!(got, "/a:/b:/c:/x:/y");
    }

    #[test]
    fn merge_paths_empty_input_is_empty() {
        assert_eq!(merge_paths(&[String::new(), String::new()]), "");
    }
}
