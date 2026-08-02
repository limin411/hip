//! Stub SFTP commands when Cargo feature `ssh` is disabled.
//! Keeps the IPC surface registered so the app still compiles.

use serde::Serialize;
use tauri::State;

use crate::ssh_session::SshManager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpLsResult {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

/// Empty transfer state for manage().
pub struct SftpTransferState;

impl SftpTransferState {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SftpTransferState {
    fn default() -> Self {
        Self::new()
    }
}

fn unavailable() -> String {
    "SSH/SFTP support is not compiled into this build (enable Cargo feature `ssh`)".into()
}

#[tauri::command]
pub async fn sftp_ls(
    _manager: State<'_, SshManager>,
    _terminal_id: String,
    _path: String,
) -> Result<SftpLsResult, String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn sftp_mkdir(
    _manager: State<'_, SshManager>,
    _terminal_id: String,
    _path: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn sftp_read_file(
    _manager: State<'_, SshManager>,
    _terminal_id: String,
    _path: String,
    _max_bytes: Option<usize>,
) -> Result<String, String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn sftp_remove(
    _manager: State<'_, SshManager>,
    _terminal_id: String,
    _path: String,
    _is_dir: bool,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn sftp_download(
    _manager: State<'_, SshManager>,
    _transfers: State<'_, SftpTransferState>,
    _terminal_id: String,
    _remote_path: String,
    _local_path: String,
    _force: bool,
    _op_id: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn sftp_upload(
    _manager: State<'_, SshManager>,
    _transfers: State<'_, SftpTransferState>,
    _terminal_id: String,
    _local_path: String,
    _remote_path: String,
    _force: bool,
    _op_id: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn sftp_cancel(
    _transfers: State<'_, SftpTransferState>,
    _terminal_id: String,
    _op_id: String,
) -> Result<(), String> {
    Err(unavailable())
}
