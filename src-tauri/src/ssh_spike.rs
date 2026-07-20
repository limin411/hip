//! PR0 SSH spike — compile-path proof for `russh` (password / ed25519 / passphrase / TOFU).
//!
//! Gated behind Cargo feature `ssh-spike`. Not registered as Tauri commands; nothing
//! ships to the UI. See `docs/design/2026-07-20-terminal-ssh-spike.md`.
//!
//! This module is intentionally **not** the production `ssh_session.rs`. It only
//! proves the APIs PR5 will call compile and type-check against russh 0.54.

#![cfg(feature = "ssh-spike")]
// Intentionally not wired into Tauri commands — compile-path + unit tests only.
#![allow(dead_code)]

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Handle};
use russh::keys::{self, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelMsg, Disconnect};

/// Host-key decision returned by TOFU checks (maps to PR5 modal outcomes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyDecision {
    /// First time seeing this host — pin & proceed after product policy allows.
    TrustOnFirstUse { fingerprint_sha256: String },
    /// Key matches a previously trusted pin.
    Matched,
    /// Algorithm matches but bytes differ — MITM risk; block in product.
    Mismatch {
        fingerprint_sha256: String,
        previous_fingerprint_sha256: Option<String>,
    },
}

/// OpenSSH-style SHA256 fingerprint string (`SHA256:…` base64, no padding).
pub fn sha256_fingerprint(key: &PublicKey) -> String {
    // Display impl of Fingerprint is already `SHA256:…` OpenSSH form.
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// Minimal TOFU comparison used by PR5 (`ssh_known_hosts.json` will own storage).
///
/// - `trusted` is the previously pinned key for this host:port (if any).
/// - On first contact (`trusted == None`) → `TrustOnFirstUse`.
/// - Same key → `Matched`.
/// - Different key → `Mismatch` (product shows modal; never auto-update).
pub fn tofu_check(server_key: &PublicKey, trusted: Option<&PublicKey>) -> HostKeyDecision {
    let fingerprint_sha256 = sha256_fingerprint(server_key);
    match trusted {
        None => HostKeyDecision::TrustOnFirstUse { fingerprint_sha256 },
        Some(prev) if prev == server_key => HostKeyDecision::Matched,
        Some(prev) => HostKeyDecision::Mismatch {
            fingerprint_sha256,
            previous_fingerprint_sha256: Some(sha256_fingerprint(prev)),
        },
    }
}

/// Client handler skeleton for PR5: host-key check is the only required method.
///
/// Product TOFU lives outside this handler (catalog file). The handler receives a
/// precomputed allow/deny from the connect path so we never trust blindly by default.
pub struct SpikeHandler {
    pub allow_server_key: bool,
}

impl client::Handler for SpikeHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(self.allow_server_key)
    }
}

/// Auth inputs exercised by the spike (v1 product matrix).
pub enum SpikeAuth {
    /// `session.authenticate_password(user, password)`.
    Password { password: String },
    /// Load OpenSSH/PKCS8 private key (ed25519 or rsa); optional passphrase.
    PublicKey {
        private_key_path: std::path::PathBuf,
        passphrase: Option<String>,
    },
}

/// Load a private key from disk, optionally decrypting with a passphrase.
///
/// Covers:
/// - unencrypted ed25519 / rsa
/// - encrypted key + passphrase (`load_secret_key(path, Some(passphrase))`)
pub fn load_private_key(
    path: impl AsRef<Path>,
    passphrase: Option<&str>,
) -> Result<PrivateKey, keys::Error> {
    keys::load_secret_key(path, passphrase)
}

/// Decode a private key from PEM/OpenSSH text (used by tests + encrypted-key path).
pub fn decode_private_key(
    pem: &str,
    passphrase: Option<&str>,
) -> Result<PrivateKey, keys::Error> {
    keys::decode_secret_key(pem, passphrase)
}

/// Prove the password auth method type-checks against a live handle.
pub async fn authenticate_password(
    session: &mut Handle<SpikeHandler>,
    user: impl Into<String>,
    password: impl Into<String>,
) -> Result<AuthResult, russh::Error> {
    session.authenticate_password(user, password).await
}

/// Prove publickey auth (ed25519/rsa) type-checks, including RSA hash negotiation.
pub async fn authenticate_publickey(
    session: &mut Handle<SpikeHandler>,
    user: impl Into<String>,
    key: PrivateKey,
) -> Result<AuthResult, russh::Error> {
    let hash_alg = session.best_supported_rsa_hash().await?.flatten();
    session
        .authenticate_publickey(
            user,
            PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
        )
        .await
}

/// Connect skeleton: TCP + kex + handler host-key gate (no network in unit tests).
///
/// PR5 will call this shape inside `tauri::async_runtime::spawn` after budget acquire.
pub async fn connect_spike(
    addrs: impl tokio::net::ToSocketAddrs,
    allow_server_key: bool,
) -> Result<Handle<SpikeHandler>, russh::Error> {
    let config = client::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    };
    let config = Arc::new(config);
    let handler = SpikeHandler { allow_server_key };
    client::connect(config, addrs, handler).await
}

/// Interactive shell channel sketch (request_pty + shell) — I/O loop lives in PR5.
pub async fn open_shell_channel(
    session: &Handle<SpikeHandler>,
    cols: u32,
    rows: u32,
) -> Result<russh::Channel<client::Msg>, russh::Error> {
    let channel = session.channel_open_session().await?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    channel.request_shell(false).await?;
    Ok(channel)
}

/// Drain one channel message — documents the event variant PR5 will map to `ssh:data`.
pub async fn poll_channel_data(channel: &mut russh::Channel<client::Msg>) -> Option<ChannelMsg> {
    channel.wait().await
}

/// Clean disconnect helper.
pub async fn disconnect(session: &Handle<SpikeHandler>) -> Result<(), russh::Error> {
    session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await
}

/// Compile-time auth matrix checklist (called from unit test so symbols stay live).
pub fn auth_matrix_supported() -> &'static [(&'static str, bool)] {
    &[
        ("password", true),
        ("publickey-ed25519", true),
        ("publickey-rsa", true),
        ("publickey-encrypted+passphrase", true),
        ("keyboard-interactive", false), // v1 non-goal — surface “暂不支持”
        ("certificate", false),
        ("agent-forward", false),
        ("pkcs11", false),
    ]
}

/// Touch decrypt + fingerprint + client config so release LTO cannot fully DCE the
/// russh/aws-lc surface when measuring binary size with `--features ssh-spike`.
///
/// Called once from `lib::run` under the feature flag (feature is off by default).
#[inline(never)]
pub fn size_probe_link_anchor() -> usize {
    // ssh-keygen -t ed25519 -N "" test fixture (same as unit tests).
    const OPENSSH_ED25519: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n\
QyNTUxOQAAACBiokB8lBPXaGEXVkH9v1rrviDBWGvRJIcrEU8b2c21sAAAAJB5NdCqeTXQ\n\
qgAAAAtzc2gtZWQyNTUxOQAAACBiokB8lBPXaGEXVkH9v1rrviDBWGvRJIcrEU8b2c21sA\n\
AAAEAiHKsrDB1m0zH9AuSSfT6+zH7bgUmYYCLK4d01XZqczGKiQHyUE9doYRdWQf2/Wuu+\n\
IMFYa9EkhysRTxvZzbWwAAAACWhpcC1zcGlrZQECAwQ=\n\
-----END OPENSSH PRIVATE KEY-----\n";

    let mut n = auth_matrix_supported().len();
    if let Ok(key) = decode_private_key(OPENSSH_ED25519, None) {
        n = n.wrapping_add(sha256_fingerprint(key.public_key()).len());
        let decision = tofu_check(key.public_key(), None);
        n = n.wrapping_add(std::mem::size_of_val(&decision));
    }
    let cfg = client::Config::default();
    n = n.wrapping_add(std::mem::size_of_val(&cfg));
    n = n.wrapping_add(std::mem::size_of::<SpikeHandler>());
    // Keep client handle/auth result types monomorphized for SpikeHandler.
    n = n.wrapping_add(std::mem::size_of::<Handle<SpikeHandler>>());
    n = n.wrapping_add(std::mem::size_of::<AuthResult>());
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::rand_core::OsRng;
    use russh::keys::Algorithm;

    // Encrypted PKCS8 sample from russh keys docs (passphrase: "blabla").
    const PKCS8_ENCRYPTED: &str = "-----BEGIN ENCRYPTED PRIVATE KEY-----\n\
MIGjMF8GCSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBAWQiUHKoocuxfoZ/hF\n\
YTjkAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQ83d1d5/S2wz475uC\n\
CUrE7QRAvdVpD5e3zKH/MZjilWrMOm6cyI1LKBCssLztPyvOALtroLAPlp7WYWfu\n\
9Sncmm7u14n2lia7r1r5I3VBsVuH0g==\n\
-----END ENCRYPTED PRIVATE KEY-----\n";

    // ssh-keygen -t ed25519 -N "" (test-only; never used on a real host).
    const OPENSSH_ED25519: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n\
QyNTUxOQAAACBiokB8lBPXaGEXVkH9v1rrviDBWGvRJIcrEU8b2c21sAAAAJB5NdCqeTXQ\n\
qgAAAAtzc2gtZWQyNTUxOQAAACBiokB8lBPXaGEXVkH9v1rrviDBWGvRJIcrEU8b2c21sA\n\
AAAEAiHKsrDB1m0zH9AuSSfT6+zH7bgUmYYCLK4d01XZqczGKiQHyUE9doYRdWQf2/Wuu+\n\
IMFYa9EkhysRTxvZzbWwAAAACWhpcC1zcGlrZQECAwQ=\n\
-----END OPENSSH PRIVATE KEY-----\n";

    // ssh-keygen -t ed25519 -N "testpass" (test-only).
    const OPENSSH_ED25519_ENC: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABBY2AKToo\n\
FsodwSpQxeZ9brAAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAICcu6KC1q61Rdi3V\n\
6Cro7lSReZDp9RnBUg2UKVrCEbZhAAAAkA/yjjvJkLvW6xfe9C1IK4+aipVXEyMyhUQ34q\n\
GrwiQulq/u8Qg3BmWQxPNzt+UhNL6J1tNG6qb1cTkf5Rt/5sYCWBYenOu4T3ILyNQQ/KfS\n\
OoqUN4DtddkyoRIMdqbKK/hoM4J7l/HH3bXqAeJu31TGlqlAwHmr+4Ba6sv05Y9yo5MY9o\n\
xU0xqW3VLuXwtDrQ==\n\
-----END OPENSSH PRIVATE KEY-----\n";

    #[test]
    fn auth_matrix_lists_v1_methods() {
        let m = auth_matrix_supported();
        assert!(m.iter().any(|(k, ok)| *k == "password" && *ok));
        assert!(m.iter().any(|(k, ok)| *k == "publickey-ed25519" && *ok));
        assert!(m
            .iter()
            .any(|(k, ok)| *k == "publickey-encrypted+passphrase" && *ok));
        assert!(m
            .iter()
            .any(|(k, ok)| *k == "keyboard-interactive" && !*ok));
    }

    #[test]
    fn decrypt_pkcs8_with_passphrase() {
        let key = decode_private_key(PKCS8_ENCRYPTED, Some("blabla"))
            .expect("decrypt PKCS8 with passphrase");
        let fp = sha256_fingerprint(key.public_key());
        assert!(fp.starts_with("SHA256:"), "fp={fp}");
    }

    #[test]
    fn decrypt_openssh_ed25519_with_passphrase() {
        let key = decode_private_key(OPENSSH_ED25519_ENC, Some("testpass"))
            .expect("decrypt OpenSSH ed25519 with passphrase");
        assert_eq!(key.algorithm(), Algorithm::Ed25519);
        let fp = sha256_fingerprint(key.public_key());
        assert!(fp.starts_with("SHA256:"), "fp={fp}");
    }

    #[test]
    fn decrypt_encrypted_key_wrong_passphrase_fails() {
        assert!(decode_private_key(PKCS8_ENCRYPTED, Some("wrong")).is_err());
        assert!(decode_private_key(OPENSSH_ED25519_ENC, Some("wrong")).is_err());
    }

    #[test]
    fn load_unencrypted_ed25519_openssh() {
        let key = decode_private_key(OPENSSH_ED25519, None).expect("ed25519 openssh");
        assert_eq!(key.algorithm(), Algorithm::Ed25519);
    }

    #[test]
    fn tofu_first_use_match_mismatch() {
        let k1 = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("key1");
        let k2 = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).expect("key2");
        let p1 = k1.public_key().clone();
        let p2 = k2.public_key().clone();

        match tofu_check(&p1, None) {
            HostKeyDecision::TrustOnFirstUse { fingerprint_sha256 } => {
                assert!(fingerprint_sha256.starts_with("SHA256:"));
            }
            other => panic!("expected TOFU, got {other:?}"),
        }

        assert_eq!(tofu_check(&p1, Some(&p1)), HostKeyDecision::Matched);

        match tofu_check(&p2, Some(&p1)) {
            HostKeyDecision::Mismatch {
                fingerprint_sha256,
                previous_fingerprint_sha256,
            } => {
                assert!(fingerprint_sha256.starts_with("SHA256:"));
                assert_ne!(
                    Some(fingerprint_sha256.as_str()),
                    previous_fingerprint_sha256.as_deref()
                );
            }
            other => panic!("expected mismatch, got {other:?}"),
        }
    }

    #[test]
    fn load_secret_key_api_accepts_passphrase_option_signature() {
        // Type-level proof: Option<&str> passphrase is the decrypt path.
        // Missing path errors at open — expected.
        assert!(load_private_key("/nonexistent/hip-ssh-spike-key", Some("passphrase")).is_err());
        assert!(load_private_key("/nonexistent/hip-ssh-spike-key", None).is_err());
    }
}
