//! Ensure a working `rg` (ripgrep) binary is available for hip agents.
//!
//! On every app start we:
//! 1. Prefer an existing system / PATH / `HIP_RG_BIN` install.
//! 2. Else reuse `~/.hip/bin/rg` (or `$HIP_DATA_DIR/bin/rg`) if already present.
//! 3. Else download a pinned GitHub release asset from
//!    https://github.com/BurntSushi/ripgrep and install it under hip's bin dir.
//!
//! Download failures are non-fatal — the sidecar keeps its JS grep fallback.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

use crate::path_tools::is_executable;
use crate::paths;

/// Pinned release — bump deliberately with asset SHAs below.
const RG_VERSION: &str = "15.2.0";
const USER_AGENT: &str = "hip-ripgrep/1.0 (+https://github.com/limin411/hip)";

/// Platform archive for the current host, with expected SHA-256 of the download.
struct Asset {
    /// File name under the release (e.g. `ripgrep-15.2.0-aarch64-apple-darwin.tar.gz`).
    name: &'static str,
    sha256_hex: &'static str,
}

fn host_asset() -> Option<Asset> {
    // Prefer musl on Linux for broader glibc-independence.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some(Asset {
            name: "ripgrep-15.2.0-aarch64-apple-darwin.tar.gz",
            sha256_hex: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4",
        });
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Some(Asset {
            name: "ripgrep-15.2.0-x86_64-apple-darwin.tar.gz",
            sha256_hex: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1",
        });
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Some(Asset {
            name: "ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz",
            sha256_hex: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915",
        });
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Some(Asset {
            name: "ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz",
            sha256_hex: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return Some(Asset {
            name: "ripgrep-15.2.0-aarch64-pc-windows-msvc.zip",
            sha256_hex: "e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f",
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(Asset {
            name: "ripgrep-15.2.0-x86_64-pc-windows-msvc.zip",
            sha256_hex: "71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5",
        });
    }
    #[allow(unreachable_code)]
    None
}

fn rg_bin_name() -> &'static str {
    if cfg!(windows) {
        "rg.exe"
    } else {
        "rg"
    }
}

/// hip-managed install location (`~/.hip/bin/rg` or `$HIP_DATA_DIR/bin/rg`).
pub fn managed_rg_path(app: &AppHandle) -> Option<PathBuf> {
    Some(paths::bin_dir(app)?.join(rg_bin_name()))
}

/// True when `p` looks like a runnable rg binary.
fn is_rg_binary(p: &Path) -> bool {
    if !is_executable(p) {
        return false;
    }
    // Cheap smoke: `rg --version` must exit 0 and mention ripgrep.
    let out = Command::new(p).arg("--version").output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            s.to_ascii_lowercase().contains("ripgrep")
        }
        _ => false,
    }
}

/// Resolve an existing rg without downloading.
pub fn find_existing_rg(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HIP_RG_BIN") {
        let path = PathBuf::from(p.trim());
        if is_rg_binary(&path) {
            return Some(path);
        }
    }

    if let Some(managed) = managed_rg_path(app) {
        if is_rg_binary(&managed) {
            return Some(managed);
        }
    }

    // PATH probe (after path_env::ensure_user_path).
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(rg_bin_name());
            if is_rg_binary(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Ensure hip's bin dir is early on PATH so managed `rg` is visible to the sidecar.
pub fn prepend_hip_bin_to_path(app: &AppHandle) {
    let Some(bin) = paths::bin_dir(app) else {
        return;
    };
    let bin_s = bin.to_string_lossy().to_string();
    if bin_s.is_empty() {
        return;
    }
    let current = std::env::var("PATH").unwrap_or_default();
    let sep = crate::path_env::path_sep();
    // Already first?
    if current
        .split(sep)
        .next()
        .map(|d| d == bin_s)
        .unwrap_or(false)
    {
        return;
    }
    let merged = crate::path_env::merge_paths(&[bin_s, current]);
    if !merged.is_empty() {
        std::env::set_var("PATH", merged);
    }
}

fn sha256_hex_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn download_url(asset_name: &str) -> String {
    format!(
        "https://github.com/BurntSushi/ripgrep/releases/download/{RG_VERSION}/{asset_name}"
    )
}

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download HTTP {}", resp.status()));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("download body: {e}"))
}

/// Extract `rg` from a downloaded archive into `dest_bin` (full path including filename).
fn extract_rg_from_archive(archive_bytes: &[u8], archive_name: &str, dest_bin: &Path) -> Result<(), String> {
    let tmp_parent = dest_bin
        .parent()
        .ok_or_else(|| "dest has no parent".to_string())?;
    fs::create_dir_all(tmp_parent).map_err(|e| e.to_string())?;

    let staging = tmp_parent.join(format!(
        ".rg-extract-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let result = (|| -> Result<PathBuf, String> {
        if archive_name.ends_with(".zip") {
            extract_rg_from_zip(archive_bytes, &staging)
        } else if archive_name.ends_with(".tar.gz") || archive_name.ends_with(".tgz") {
            extract_rg_from_tar_gz(archive_bytes, archive_name, &staging)
        } else {
            Err(format!("unsupported archive: {archive_name}"))
        }
    })();

    match result {
        Ok(found) => {
            // Atomic-ish replace: write to temp then rename.
            let tmp_out = dest_bin.with_extension("tmp");
            fs::copy(&found, &tmp_out).map_err(|e| {
                let _ = fs::remove_dir_all(&staging);
                e.to_string()
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&tmp_out, fs::Permissions::from_mode(0o755));
            }
            fs::rename(&tmp_out, dest_bin).map_err(|e| {
                let _ = fs::remove_file(&tmp_out);
                let _ = fs::remove_dir_all(&staging);
                e.to_string()
            })?;
            let _ = fs::remove_dir_all(&staging);
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            Err(e)
        }
    }
}

fn extract_rg_from_zip(bytes: &[u8], staging: &Path) -> Result<PathBuf, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let want = rg_bin_name();
    let mut found: Option<PathBuf> = None;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let base = Path::new(&name)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        // Only extract the rg binary (skip LICENSE, complete/, …).
        if base != want && base != "rg" && base != "rg.exe" {
            continue;
        }
        let out_name = if base.ends_with(".exe") || cfg!(windows) {
            rg_bin_name()
        } else {
            "rg"
        };
        let out = staging.join(out_name);
        {
            let mut file = fs::File::create(&out).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
        }
        found = Some(out);
        break;
    }
    found.ok_or_else(|| "rg binary not found inside zip".to_string())
}

/// Use system `tar` for .tar.gz (always present on macOS/Linux product targets).
fn extract_rg_from_tar_gz(bytes: &[u8], archive_name: &str, staging: &Path) -> Result<PathBuf, String> {
    let archive_path = staging.join(archive_name);
    fs::write(&archive_path, bytes).map_err(|e| e.to_string())?;
    let status = Command::new("tar")
        .args(["-xzf"])
        .arg(&archive_path)
        .arg("-C")
        .arg(staging)
        .status()
        .map_err(|e| format!("tar spawn failed: {e}"))?;
    if !status.success() {
        return Err(format!("tar exited with {status}"));
    }
    // Archive layout: ripgrep-<ver>-<triple>/rg
    find_rg_in_dir(staging).ok_or_else(|| "rg binary not found inside tar.gz".to_string())
}

fn find_rg_in_dir(dir: &Path) -> Option<PathBuf> {
    let want = rg_bin_name();
    fn walk(dir: &Path, want: &str, depth: u8) -> Option<PathBuf> {
        if depth > 4 {
            return None;
        }
        let rd = fs::read_dir(dir).ok()?;
        for ent in rd.flatten() {
            let p = ent.path();
            let name = ent.file_name();
            let name_s = name.to_string_lossy();
            if p.is_file() && (name_s == want || name_s == "rg" || name_s == "rg.exe") {
                return Some(p);
            }
            if p.is_dir() {
                if let Some(f) = walk(&p, want, depth + 1) {
                    return Some(f);
                }
            }
        }
        None
    }
    walk(dir, want, 0)
}

/// Download + install managed rg. Returns the installed path.
async fn install_managed_rg(app: &AppHandle) -> Result<PathBuf, String> {
    let asset = host_asset().ok_or_else(|| "unsupported platform for bundled ripgrep".to_string())?;
    let dest = managed_rg_path(app).ok_or_else(|| "could not resolve hip bin dir".to_string())?;
    let url = download_url(asset.name);
    println!("[tauri] ripgrep: downloading {url}");
    let bytes = download_bytes(&url).await?;
    let hex = sha256_hex_bytes(&bytes);
    if !hex.eq_ignore_ascii_case(asset.sha256_hex) {
        return Err(format!(
            "ripgrep sha256 mismatch: got {hex}, expected {}",
            asset.sha256_hex
        ));
    }
    extract_rg_from_archive(&bytes, asset.name, &dest)?;
    if !is_rg_binary(&dest) {
        let _ = fs::remove_file(&dest);
        return Err("installed rg failed --version smoke check".into());
    }
    println!("[tauri] ripgrep: installed {}", dest.display());
    Ok(dest)
}

/// Public entry: resolve or install rg. Never panics; logs on failure.
pub async fn ensure_ripgrep(app: &AppHandle) {
    prepend_hip_bin_to_path(app);

    if let Some(existing) = find_existing_rg(app) {
        println!("[tauri] ripgrep: using {}", existing.display());
        // Still keep managed path preference on PATH for other tools.
        prepend_hip_bin_to_path(app);
        return;
    }

    match install_managed_rg(app).await {
        Ok(p) => {
            prepend_hip_bin_to_path(app);
            println!("[tauri] ripgrep: ready at {}", p.display());
        }
        Err(e) => {
            eprintln!("[tauri] ripgrep: ensure failed ({e}); sidecar will use JS grep fallback");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_asset_is_defined_on_supported_targets() {
        // CI runs on mac/linux/windows x64/arm — asset must resolve.
        let a = host_asset();
        assert!(a.is_some(), "host_asset() missing for this target");
        let a = a.unwrap();
        assert!(a.name.contains(RG_VERSION));
        assert_eq!(a.sha256_hex.len(), 64);
    }

    #[test]
    fn download_url_points_at_burntsushi_release() {
        let url = download_url("ripgrep-15.2.0-aarch64-apple-darwin.tar.gz");
        assert!(url.starts_with("https://github.com/BurntSushi/ripgrep/releases/download/"));
        assert!(url.contains(RG_VERSION));
    }

    #[test]
    fn sha256_hex_bytes_known_vector() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            sha256_hex_bytes(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn find_rg_in_dir_nested() {
        let dir = std::env::temp_dir().join(format!("hip-rg-find-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let nested = dir.join("ripgrep-15.2.0-test");
        fs::create_dir_all(&nested).unwrap();
        let rg = nested.join("rg");
        fs::write(&rg, b"#!/bin/sh\necho ripgrep\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&rg, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let found = find_rg_in_dir(&dir).expect("find rg");
        assert_eq!(found, rg);
        let _ = fs::remove_dir_all(&dir);
    }
}
