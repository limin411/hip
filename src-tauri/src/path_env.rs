//! Make the app see the user's REAL global PATH.
//!
//! A macOS app launched from Finder/Dock/an IDE inherits a minimal PATH
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) — NOT the user's interactive shell PATH. Tools
//! installed in user dirs (`~/.npm-global/bin`, `/opt/homebrew/bin`, version-manager
//! dirs, …) are then invisible. Windows GUI launches can similarly miss user-scoped
//! dirs and tools installed after login. We fix this once at startup so detection
//! (`which_binaries`), the sidecar, PTY shells, and every spawned ACP/CLI agent all
//! see the same, correct global PATH.

use std::collections::HashSet;
use std::time::{Duration, Instant};

/// Platform PATH list separator (`:` on Unix, `;` on Windows).
pub fn path_sep() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

/// Merge PATH-like strings into one: preserve first-seen order, dedup, drop empty
/// segments. Uses the host platform separator.
pub fn merge_paths(parts: &[String]) -> String {
    merge_paths_with_sep(parts, path_sep())
}

/// Pure merge helper (unit-tested with an explicit separator).
pub fn merge_paths_with_sep(parts: &[String], sep: char) -> String {
    let mut seen = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for part in parts {
        for d in part.split(sep) {
            let d = d.trim();
            if !d.is_empty() && seen.insert(d.to_string()) {
                out.push(d.to_string());
            }
        }
    }
    out.join(&sep.to_string())
}

/// Common global bin dirs where user-installed CLIs land regardless of installer
/// (npm -g, Homebrew, cargo, pnpm, Grok Build, …). A safe baseline so a GUI-stripped
/// PATH still finds globally-installed tools even when the login-shell probe is unavailable.
pub(crate) fn common_dirs() -> String {
    #[cfg(windows)]
    {
        let mut dirs: Vec<String> = Vec::new();
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        dirs.push(format!("{system_root}\\System32"));
        dirs.push(format!("{system_root}\\System32\\WindowsPowerShell\\v1.0"));
        if let Ok(pf) = std::env::var("ProgramFiles") {
            dirs.push(format!("{pf}\\Git\\cmd"));
            dirs.push(format!("{pf}\\Git\\bin"));
            dirs.push(format!("{pf}\\nodejs"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            dirs.push(format!("{pf86}\\Git\\cmd"));
            dirs.push(format!("{pf86}\\Git\\bin"));
        }
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            for sub in [
                ".hip\\bin", // hip-managed tools (ripgrep, …)
                ".cargo\\bin",
                ".local\\bin",
                ".bun\\bin",
                ".deno\\bin",
                ".grok\\bin", // Grok Build CLI (https://x.ai/cli)
                "AppData\\Roaming\\npm",
                "AppData\\Local\\pnpm",
                "AppData\\Local\\Yarn\\bin",
                "AppData\\Local\\Programs\\Microsoft VS Code\\bin",
            ] {
                dirs.push(format!("{home}\\{sub}"));
            }
        }
        dirs.join(";")
    }
    #[cfg(not(windows))]
    {
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
                ".hip/bin", // hip-managed tools (ripgrep, …)
                ".npm-global/bin",
                ".local/bin",
                ".cargo/bin",
                ".bun/bin",
                ".deno/bin",
                ".grok/bin", // Grok Build CLI (https://x.ai/cli)
                "Library/pnpm",
                ".volta/bin",
                ".yarn/bin",
            ] {
                dirs.push(format!("{home}/{sub}"));
            }
        }
        dirs.join(":")
    }
}

/// Wait for a child with a short deadline; kill on timeout. Returns stdout if exited.
fn wait_stdout_deadline(
    mut child: std::process::Child,
    deadline: Instant,
) -> Option<std::process::Output> {
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(_) => return None,
        }
    }
}

/// Best-effort: capture the PATH of the user's interactive login shell (covers version
/// managers like nvm/fnm/rbenv that only mutate PATH in shell rc files). Returns None on
/// any failure or if it exceeds a short timeout.
fn login_shell_path() -> Option<String> {
    #[cfg(windows)]
    {
        // Machine + User PATH from the environment store (not just this process).
        // -NoProfile keeps the probe fast; profile PATH mutations still load inside the
        // interactive Terminal shell itself.
        const MARK: &str = "__HIP_PATH__";
        let script = format!(
            "$m=[Environment]::GetEnvironmentVariable('Path','Machine'); \
             $u=[Environment]::GetEnvironmentVariable('Path','User'); \
             Write-Output ('{MARK}' + $m + ';' + $u)"
        );
        let child = std::process::Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        let out = wait_stdout_deadline(child, Instant::now() + Duration::from_millis(2500))?;
        let s = String::from_utf8_lossy(&out.stdout);
        let idx = s.rfind(MARK)?;
        let path = s[idx + MARK.len()..].trim();
        if path.is_empty() {
            None
        } else {
            Some(path.to_string())
        }
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").ok()?;
        if shell.is_empty() {
            return None;
        }
        const MARK: &str = "__HIP_PATH__";
        let child = std::process::Command::new(&shell)
            .args(["-lic", &format!("printf '{MARK}%s' \"$PATH\"")])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        let out = wait_stdout_deadline(child, Instant::now() + Duration::from_millis(2500))?;
        let s = String::from_utf8_lossy(&out.stdout);
        let idx = s.rfind(MARK)?;
        let path = s[idx + MARK.len()..].trim();
        if path.is_empty() {
            None
        } else {
            Some(path.to_string())
        }
    }
}

/// Resolve a robust PATH (login-shell ∪ current ∪ common dirs) and apply it to this
/// process, so detection, the sidecar, and every spawned agent see the user's real
/// global PATH instead of the stripped PATH a GUI-launched app inherits.
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
    use super::{common_dirs, merge_paths_with_sep, path_sep};

    #[test]
    fn common_dirs_includes_grok_bin() {
        let dirs = common_dirs();
        if cfg!(windows) {
            assert!(
                dirs.contains(r".grok\bin") || dirs.contains(".grok\\bin"),
                "expected .grok\\bin in common_dirs, got {dirs}"
            );
        } else {
            assert!(
                dirs.contains(".grok/bin"),
                "expected .grok/bin in common_dirs, got {dirs}"
            );
        }
    }

    /// ACP presets install into global npm / homebrew / cargo-style bins and
    /// (for Grok Build) `~/.grok/bin`. Lock those baseline dirs so Dock/GUI
    /// launches still detect opencode / grok / pi / claude / codex (+ adapters).
    #[test]
    fn common_dirs_covers_acp_preset_install_locations() {
        let dirs = common_dirs();
        if cfg!(windows) {
            for needle in [
                r".hip\bin",
                r".grok\bin",
                r".local\bin",
                r".cargo\bin",
                r"AppData\Roaming\npm",
            ] {
                assert!(
                    dirs.contains(needle),
                    "expected {needle} in common_dirs for ACP CLI discovery, got {dirs}"
                );
            }
        } else {
            for needle in [
                ".hip/bin",        // hip-managed: ripgrep, …
                ".grok/bin",       // grok (https://x.ai/cli)
                ".npm-global/bin", // npm -g: opencode, pi, claude, codex, adapters
                ".local/bin",
                ".cargo/bin",
                "/opt/homebrew/bin",
                "/usr/local/bin",
            ] {
                assert!(
                    dirs.contains(needle),
                    "expected {needle} in common_dirs for ACP CLI discovery, got {dirs}"
                );
            }
        }
    }

    #[test]
    fn merge_paths_dedups_preserves_order_drops_empty_unix() {
        let got = merge_paths_with_sep(
            &[
                "/a:/b".to_string(),
                "/b:/c".to_string(),
                "/a".to_string(),
                String::new(),
                "/x::/y".to_string(),
            ],
            ':',
        );
        assert_eq!(got, "/a:/b:/c:/x:/y");
    }

    #[test]
    fn merge_paths_dedups_preserves_order_drops_empty_windows() {
        let got = merge_paths_with_sep(
            &[
                r"C:\a;C:\b".to_string(),
                r"C:\b;C:\c".to_string(),
                r"C:\a".to_string(),
                String::new(),
                r"C:\x;;C:\y".to_string(),
            ],
            ';',
        );
        assert_eq!(got, r"C:\a;C:\b;C:\c;C:\x;C:\y");
    }

    #[test]
    fn merge_paths_empty_input_is_empty() {
        assert_eq!(merge_paths_with_sep(&[String::new(), String::new()], ':'), "");
        assert_eq!(merge_paths_with_sep(&[String::new(), String::new()], ';'), "");
    }

    #[test]
    fn path_sep_is_platform_correct() {
        if cfg!(windows) {
            assert_eq!(path_sep(), ';');
        } else {
            assert_eq!(path_sep(), ':');
        }
    }
}
