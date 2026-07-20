//! TOFU host-key store (`~/.hip/config/ssh_known_hosts.json`).
//!
//! Atomic write + Unix 0o600. Product source of truth (not OpenSSH known_hosts).
//! All load→mutate→save paths serialize under a process-wide mutex so concurrent
//! first-use / trust updates cannot drop each other's pins.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::Path;
use std::sync::Mutex;
use tauri::AppHandle;

/// Serializes known_hosts RMW (not just rename atomicity).
static KNOWN_HOSTS_LOCK: Mutex<()> = Mutex::new(());

/// Host-key decision returned by TOFU checks (maps to modal outcomes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyDecision {
    /// First time seeing this host — pin after successful connect.
    TrustOnFirstUse { fingerprint_sha256: String },
    /// Key matches a previously trusted pin.
    Matched,
    /// Pin differs — MITM risk; block.
    Mismatch {
        fingerprint_sha256: String,
        previous_fingerprint_sha256: Option<String>,
    },
}

/// One pinned host key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostEntry {
    /// OpenSSH authorized_keys-style public key line.
    pub public_key: String,
    /// OpenSSH-like `SHA256:…` fingerprint.
    pub fingerprint_sha256: String,
    pub updated_at: i64,
}

/// On-disk document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostsFile {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Keyed by `host_key_id` (`hostname|port`, hostname lowercased).
    #[serde(default)]
    pub hosts: BTreeMap<String, KnownHostEntry>,
}

fn default_version() -> u32 {
    1
}

/// Canonical map key for a host:port pin.
///
/// Uses `|` as delimiter so raw IPv6 addresses (`2001:db8::1`) are unambiguous.
/// Legacy keys used `hostname:port` (ambiguous for IPv6); lookup still falls back.
pub fn host_key_id(hostname: &str, port: u16) -> String {
    format!("{}|{}", hostname.trim().to_ascii_lowercase(), port)
}

/// Pre-PR5 key form `hostname:port` (kept only for read migration).
fn host_key_id_legacy(hostname: &str, port: u16) -> String {
    format!("{}:{}", hostname.trim().to_ascii_lowercase(), port)
}

/// Pure TOFU comparison on stored OpenSSH public key lines + fingerprints.
///
/// - `trusted` is the previously pinned entry (if any).
/// - `server_public_key` is the OpenSSH public key line presented by the server.
/// - `server_fingerprint` is `SHA256:…`.
pub fn tofu_check_strings(
    server_public_key: &str,
    server_fingerprint: &str,
    trusted: Option<&KnownHostEntry>,
) -> HostKeyDecision {
    match trusted {
        None => HostKeyDecision::TrustOnFirstUse {
            fingerprint_sha256: server_fingerprint.to_string(),
        },
        Some(prev) if prev.public_key.trim() == server_public_key.trim() => {
            HostKeyDecision::Matched
        }
        Some(prev) => HostKeyDecision::Mismatch {
            fingerprint_sha256: server_fingerprint.to_string(),
            previous_fingerprint_sha256: Some(prev.fingerprint_sha256.clone()),
        },
    }
}

/// Load known_hosts file. Missing/corrupt → empty default.
pub fn load_known_hosts(path: &Path) -> KnownHostsFile {
    match std::fs::read_to_string(path) {
        Ok(body) => serde_json::from_str::<KnownHostsFile>(&body).unwrap_or_default(),
        Err(_) => KnownHostsFile::default(),
    }
}

/// Persist via shared atomic 0o600 helper.
pub fn save_known_hosts(path: &Path, file: &KnownHostsFile) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = file.clone();
    if file.version == 0 {
        file.version = 1;
    }
    let body = serde_json::to_string_pretty(&file)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    crate::atomic_write::atomic_write_private(path, body.as_bytes())
}

/// Path helper for known_hosts under config/.
pub fn known_hosts_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(crate::paths::config_dir(app)?.join("ssh_known_hosts.json"))
}

/// Lookup pin for hostname:port (new key, then legacy `:` form).
pub fn get_pin<'a>(
    file: &'a KnownHostsFile,
    hostname: &str,
    port: u16,
) -> Option<&'a KnownHostEntry> {
    let key = host_key_id(hostname, port);
    file.hosts
        .get(&key)
        .or_else(|| file.hosts.get(&host_key_id_legacy(hostname, port)))
}

/// Insert or replace pin under the canonical key; drop any legacy key for the same host.
pub fn trust_host(
    file: &mut KnownHostsFile,
    hostname: &str,
    port: u16,
    public_key: String,
    fingerprint_sha256: String,
    updated_at: i64,
) {
    if file.version == 0 {
        file.version = 1;
    }
    let key = host_key_id(hostname, port);
    file.hosts.remove(&host_key_id_legacy(hostname, port));
    file.hosts.insert(
        key,
        KnownHostEntry {
            public_key,
            fingerprint_sha256,
            updated_at,
        },
    );
}

/// Remove pin if present (both canonical and legacy keys). Returns whether something was removed.
pub fn remove_host_key(file: &mut KnownHostsFile, hostname: &str, port: u16) -> bool {
    let a = file.hosts.remove(&host_key_id(hostname, port)).is_some();
    let b = file
        .hosts
        .remove(&host_key_id_legacy(hostname, port))
        .is_some();
    a || b
}

/// Load → mutate → save under the process-wide known_hosts lock (Issue 2).
pub fn with_known_hosts_mut<F, R>(path: &Path, f: F) -> Result<R, String>
where
    F: FnOnce(&mut KnownHostsFile) -> Result<R, String>,
{
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| "known_hosts lock poisoned".to_string())?;
    let mut file = load_known_hosts(path);
    let out = f(&mut file)?;
    save_known_hosts(path, &file).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Read-only load under the same lock (consistent with writers).
pub fn with_known_hosts<F, R>(path: &Path, f: F) -> Result<R, String>
where
    F: FnOnce(&KnownHostsFile) -> R,
{
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| "known_hosts lock poisoned".to_string())?;
    let file = load_known_hosts(path);
    Ok(f(&file))
}

#[tauri::command]
pub fn ssh_known_hosts_get(
    app: AppHandle,
    hostname: String,
    port: u16,
) -> Result<Option<KnownHostEntry>, String> {
    let path = known_hosts_path(&app).ok_or_else(|| "no config dir".to_string())?;
    with_known_hosts(&path, |file| get_pin(file, &hostname, port).cloned())
}

#[tauri::command]
pub fn ssh_trust_host(
    app: AppHandle,
    hostname: String,
    port: u16,
    public_key: String,
    fingerprint_sha256: String,
) -> Result<(), String> {
    let path = known_hosts_path(&app).ok_or_else(|| "no config dir".to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    with_known_hosts_mut(&path, |file| {
        trust_host(
            file,
            &hostname,
            port,
            public_key,
            fingerprint_sha256,
            now,
        );
        Ok(())
    })
}

#[tauri::command]
pub fn ssh_remove_host_key(app: AppHandle, hostname: String, port: u16) -> Result<(), String> {
    let path = known_hosts_path(&app).ok_or_else(|| "no config dir".to_string())?;
    with_known_hosts_mut(&path, |file| {
        remove_host_key(file, &hostname, port);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hip-known-hosts-test-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("ssh_known_hosts.json")
    }

    #[test]
    fn host_key_id_uses_pipe_and_normalizes_case() {
        assert_eq!(host_key_id("Host.Example", 22), "host.example|22");
        assert_eq!(host_key_id("2001:db8::1", 22), "2001:db8::1|22");
    }

    #[test]
    fn get_pin_falls_back_to_legacy_colon_key() {
        let mut file = KnownHostsFile::default();
        file.hosts.insert(
            host_key_id_legacy("example.com", 22),
            KnownHostEntry {
                public_key: "ssh-ed25519 AAAA".into(),
                fingerprint_sha256: "SHA256:old".into(),
                updated_at: 1,
            },
        );
        let pin = get_pin(&file, "example.com", 22).unwrap();
        assert_eq!(pin.fingerprint_sha256, "SHA256:old");
    }

    #[test]
    fn tofu_first_use_match_mismatch() {
        let k1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyOne host1";
        let k2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKeyTwo host2";
        let fp1 = "SHA256:aaaaaaaa";
        let fp2 = "SHA256:bbbbbbbb";

        match tofu_check_strings(k1, fp1, None) {
            HostKeyDecision::TrustOnFirstUse { fingerprint_sha256 } => {
                assert_eq!(fingerprint_sha256, fp1);
            }
            other => panic!("expected TOFU, got {other:?}"),
        }

        let pinned = KnownHostEntry {
            public_key: k1.to_string(),
            fingerprint_sha256: fp1.to_string(),
            updated_at: 1,
        };
        assert_eq!(
            tofu_check_strings(k1, fp1, Some(&pinned)),
            HostKeyDecision::Matched
        );

        match tofu_check_strings(k2, fp2, Some(&pinned)) {
            HostKeyDecision::Mismatch {
                fingerprint_sha256,
                previous_fingerprint_sha256,
            } => {
                assert_eq!(fingerprint_sha256, fp2);
                assert_eq!(previous_fingerprint_sha256.as_deref(), Some(fp1));
            }
            other => panic!("expected mismatch, got {other:?}"),
        }
    }

    #[test]
    fn roundtrip_atomic_save() {
        let p = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&p);
        let mut file = KnownHostsFile::default();
        trust_host(
            &mut file,
            "example.com",
            22,
            "ssh-ed25519 AAAA example".into(),
            "SHA256:xyz".into(),
            42,
        );
        save_known_hosts(&p, &file).unwrap();
        let loaded = load_known_hosts(&p);
        assert_eq!(loaded.version, 1);
        let pin = get_pin(&loaded, "Example.COM", 22).unwrap();
        assert_eq!(pin.fingerprint_sha256, "SHA256:xyz");
        assert!(remove_host_key(&mut file, "example.com", 22));
        assert!(get_pin(&file, "example.com", 22).is_none());
    }

    #[test]
    fn with_known_hosts_mut_serializes_writes() {
        let p = tmp_path("rmw");
        let _ = std::fs::remove_file(&p);
        with_known_hosts_mut(&p, |file| {
            trust_host(
                file,
                "a.example",
                22,
                "ssh-ed25519 A".into(),
                "SHA256:a".into(),
                1,
            );
            Ok(())
        })
        .unwrap();
        with_known_hosts_mut(&p, |file| {
            trust_host(
                file,
                "b.example",
                22,
                "ssh-ed25519 B".into(),
                "SHA256:b".into(),
                2,
            );
            Ok(())
        })
        .unwrap();
        let loaded = load_known_hosts(&p);
        assert!(get_pin(&loaded, "a.example", 22).is_some());
        assert!(get_pin(&loaded, "b.example", 22).is_some());
    }

    #[test]
    #[cfg(unix)]
    fn known_hosts_file_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        let _ = std::fs::remove_file(&p);
        let file = KnownHostsFile {
            version: 1,
            hosts: BTreeMap::new(),
        };
        save_known_hosts(&p, &file).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
