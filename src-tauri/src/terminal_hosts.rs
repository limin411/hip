//! Host catalog for Terminal Management (`~/.hip/config/terminal-hosts.json`).
//!
//! Non-secret inventory: flat groups, hosts, and recent launches.
//! Passwords / passphrases live in `auth.json` under `hip.ssh.<hostId>.*` raw keys.

use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;
use tauri::AppHandle;

/// Flat host group (no nesting / parentId).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostGroup {
    pub id: String,
    pub name: String,
    pub sort: i64,
}

/// Saved SSH host entry. Credentials are NOT stored here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHost {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    /// `"password"` | `"privateKey"`.
    pub auth_method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_path: Option<String>,
    pub updated_at: i64,
}

/// Recent successful launch entry (cap enforced on the frontend store).
///
/// Internally tagged `{ type: "local"|"ssh", ... }`. Enum-level `rename_all`
/// only renames **variants**; fields that need camelCase use per-field rename.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RecentLaunch {
    Local {
        cwd: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        at: i64,
    },
    Ssh {
        #[serde(rename = "hostId")]
        host_id: String,
        label: String,
        at: i64,
    },
}

/// Persisted managed-terminal record (P2: `tm_*` survives app restarts, D8/D12).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecord {
    pub id: String,
    #[serde(rename = "hostId")]
    pub host_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_path: Option<String>,
    /// Persisted value is always `disconnected`; live states stay in memory.
    pub status: String,
    pub created_at: i64,
}

/// Full on-disk catalog document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalHostsCatalog {
    pub version: u32,
    #[serde(default)]
    pub groups: Vec<HostGroup>,
    #[serde(default)]
    pub hosts: Vec<TerminalHost>,
    #[serde(default)]
    pub recents: Vec<RecentLaunch>,
    #[serde(default)]
    pub terminal_records: Vec<TerminalRecord>,
}

impl Default for TerminalHostsCatalog {
    fn default() -> Self {
        Self {
            version: 1,
            groups: Vec::new(),
            hosts: Vec::new(),
            recents: Vec::new(),
            terminal_records: Vec::new(),
        }
    }
}

/// Read catalog. Missing or corrupt file → empty default (never errors for load).
pub fn load_catalog(path: &Path) -> TerminalHostsCatalog {
    match std::fs::read_to_string(path) {
        Ok(body) => serde_json::from_str::<TerminalHostsCatalog>(&body).unwrap_or_default(),
        Err(_) => TerminalHostsCatalog::default(),
    }
}

/// Drop SSH recents whose `hostId` is not in the host list (K11 load rule).
pub fn sanitize_recents(catalog: &mut TerminalHostsCatalog) {
    let host_ids: std::collections::HashSet<&str> =
        catalog.hosts.iter().map(|h| h.id.as_str()).collect();
    catalog.recents.retain(|r| match r {
        RecentLaunch::Local { .. } => true,
        RecentLaunch::Ssh { host_id, .. } => host_ids.contains(host_id.as_str()),
    });
    catalog
        .terminal_records
        .retain(|r| host_ids.contains(r.host_id.as_str()));
}

/// Persist catalog via shared atomic 0o600 helper (see `atomic_write`).
pub fn save_catalog(path: &Path, catalog: &TerminalHostsCatalog) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(catalog)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    crate::atomic_write::atomic_write_private(path, body.as_bytes())
}

#[tauri::command]
pub fn terminal_hosts_list(app: AppHandle) -> Result<TerminalHostsCatalog, String> {
    let path = crate::paths::terminal_hosts_path(&app).ok_or_else(|| "no config dir".to_string())?;
    let mut catalog = load_catalog(&path);
    sanitize_recents(&mut catalog);
    Ok(catalog)
}

#[tauri::command]
pub fn terminal_hosts_save(app: AppHandle, catalog: TerminalHostsCatalog) -> Result<(), String> {
    let path = crate::paths::terminal_hosts_path(&app).ok_or_else(|| "no config dir".to_string())?;
    let mut catalog = catalog;
    if catalog.version == 0 {
        catalog.version = 1;
    }
    sanitize_recents(&mut catalog);
    save_catalog(&path, &catalog).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hip-terminal-hosts-test-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("terminal-hosts.json")
    }

    #[test]
    fn missing_file_loads_default() {
        let p = std::env::temp_dir().join("hip-terminal-hosts-missing-xyz.json");
        let _ = std::fs::remove_file(&p);
        let cat = load_catalog(&p);
        assert_eq!(cat.version, 1);
        assert!(cat.groups.is_empty());
        assert!(cat.hosts.is_empty());
        assert!(cat.recents.is_empty());
    }

    #[test]
    fn corrupt_file_loads_default() {
        let p = tmp_path("corrupt");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        let cat = load_catalog(&p);
        assert_eq!(cat, TerminalHostsCatalog::default());
    }

    #[test]
    fn save_load_roundtrip() {
        let p = tmp_path("roundtrip");
        let _ = std::fs::remove_file(&p);
        let cat = TerminalHostsCatalog {
            version: 1,
            groups: vec![HostGroup {
                id: "grp_1".into(),
                name: "prod".into(),
                sort: 0,
            }],
            hosts: vec![TerminalHost {
                id: "hst_1".into(),
                label: "ops-1".into(),
                group_id: Some("grp_1".into()),
                hostname: "10.0.0.8".into(),
                port: 22,
                username: "deploy".into(),
                auth_method: "privateKey".into(),
                private_key_path: Some("/Users/me/.ssh/id_ed25519".into()),
                remote_path: Some("/var/www".into()),
                updated_at: 1_720_000_000_000,
            }],
            recents: vec![
                RecentLaunch::Ssh {
                    host_id: "hst_1".into(),
                    label: "ops-1".into(),
                    at: 1_720_000_001_000,
                },
                RecentLaunch::Local {
                    cwd: "/tmp".into(),
                    label: Some("tmp".into()),
                    at: 1_720_000_002_000,
                },
            ],
            terminal_records: vec![],
        };
        save_catalog(&p, &cat).unwrap();
        let loaded = load_catalog(&p);
        assert_eq!(loaded, cat);
    }

    #[test]
    fn sanitize_drops_dangling_ssh_recents() {
        let mut cat = TerminalHostsCatalog {
            version: 1,
            groups: vec![],
            hosts: vec![TerminalHost {
                id: "hst_keep".into(),
                label: "keep".into(),
                group_id: None,
                hostname: "h".into(),
                port: 22,
                username: "u".into(),
                auth_method: "password".into(),
                private_key_path: None,
                remote_path: None,
                updated_at: 1,
            }],
            recents: vec![
                RecentLaunch::Ssh {
                    host_id: "hst_keep".into(),
                    label: "keep".into(),
                    at: 2,
                },
                RecentLaunch::Ssh {
                    host_id: "hst_gone".into(),
                    label: "gone".into(),
                    at: 3,
                },
                RecentLaunch::Local {
                    cwd: "/home".into(),
                    label: None,
                    at: 4,
                },
            ],
            terminal_records: vec![],
        };
        sanitize_recents(&mut cat);
        assert_eq!(cat.recents.len(), 2);
        match &cat.recents[0] {
            RecentLaunch::Ssh { host_id, .. } => assert_eq!(host_id, "hst_keep"),
            _ => panic!("expected ssh"),
        }
        match &cat.recents[1] {
            RecentLaunch::Local { cwd, .. } => assert_eq!(cwd, "/home"),
            _ => panic!("expected local"),
        }
    }

    #[test]
    #[cfg(unix)]
    fn file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("perms");
        let _ = std::fs::remove_file(&p);
        save_catalog(&p, &TerminalHostsCatalog::default()).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    #[cfg(unix)]
    fn preexisting_wide_file_is_tightened() {
        use std::os::unix::fs::PermissionsExt;
        let p = tmp_path("wide");
        std::fs::write(&p, "{}").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        save_catalog(
            &p,
            &TerminalHostsCatalog {
                version: 1,
                groups: vec![],
                hosts: vec![],
                recents: vec![],
                terminal_records: vec![],
            },
        )
        .unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn serde_shape_matches_design() {
        let cat = TerminalHostsCatalog {
            version: 1,
            groups: vec![HostGroup {
                id: "grp_1".into(),
                name: "生产".into(),
                sort: 0,
            }],
            hosts: vec![TerminalHost {
                id: "hst_1".into(),
                label: "ops-1".into(),
                group_id: Some("grp_1".into()),
                hostname: "10.0.0.8".into(),
                port: 22,
                username: "deploy".into(),
                auth_method: "privateKey".into(),
                private_key_path: Some("/Users/me/.ssh/id_ed25519".into()),
                remote_path: Some("/var/www".into()),
                updated_at: 1_720_000_000_000,
            }],
            recents: vec![RecentLaunch::Ssh {
                host_id: "hst_1".into(),
                label: "ops-1".into(),
                at: 1_720_000_001_000,
            }],
            terminal_records: vec![],
        };
        let v: serde_json::Value = serde_json::to_value(&cat).unwrap();
        assert_eq!(v["groups"][0]["id"], "grp_1");
        assert_eq!(v["hosts"][0]["groupId"], "grp_1");
        assert_eq!(v["hosts"][0]["authMethod"], "privateKey");
        assert_eq!(v["hosts"][0]["privateKeyPath"], "/Users/me/.ssh/id_ed25519");
        assert_eq!(v["recents"][0]["type"], "ssh");
        assert_eq!(v["recents"][0]["hostId"], "hst_1");
    }
}
