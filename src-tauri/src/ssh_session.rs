//! Production SSH interactive shell via `russh` (Cargo feature `ssh`).
//!
//! Commands: ssh_open / ssh_write / ssh_resize / ssh_close / ssh_list.
//! Events: `ssh:data` (base64) / `ssh:exit` (generation required).
//! Secrets loaded only in Rust via `get_secret_value` — never exposed to renderer.

#![cfg(feature = "ssh")]

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

use russh::client::{self, Handle};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg, PublicKey};
use russh::{ChannelMsg, ChannelWriteHalf, Disconnect, Pty};

use crate::ssh_known_hosts::{
    get_pin, host_key_id, tofu_check_strings, trust_host, with_known_hosts, with_known_hosts_mut,
    HostKeyDecision, KnownHostEntry,
};
use crate::ssh_path::expand_tilde_path;
use crate::terminal_budget::{TerminalBudget, MAX_INTERACTIVE_TERMINALS};
use crate::terminal_hosts::{load_catalog, BastionConfig, TerminalHost};

// Coalesce constants — match PTY spirit (design).
const COALESCE_BYTES: usize = 32 * 1024;
const COALESCE_MS: u64 = 12;
const MAX_EMIT_RAW: usize = 192 * 1024;
const MAX_QUEUE_CHUNKS: usize = 64;
const MAX_QUEUE_BYTES: usize = 1024 * 1024;

/// Standard interactive tty modes for SSH PTY requests.
/// IXON = 0 so Ctrl-S does not freeze the remote tty (software flow control).
const SSH_INTERACTIVE_PTY_MODES: &[(Pty, u32)] = &[
    (Pty::ECHO, 1),
    (Pty::ICANON, 1),
    (Pty::ISIG, 1),
    (Pty::IEXTEN, 1),
    (Pty::ECHOE, 1),
    (Pty::ECHOK, 1),
    (Pty::OPOST, 1),
    (Pty::ONLCR, 1),
    (Pty::ICRNL, 1),
    (Pty::CS8, 1),
    (Pty::IUTF8, 1),
    (Pty::IXON, 0),
];
