//! Stub SSH commands when Cargo feature `ssh` is disabled (`--no-default-features`).
//!
//! Keeps the IPC surface registered so the app still compiles; all calls return a clear error.

use serde::Serialize;
use tauri::State;

use crate::terminal_budget::TerminalBudget;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenResult {
    pub reused: bool,
    pub generation: u64,
}

/// Empty manager so `manage` + kill_all paths type-check without russh.
pub struct SshManager;

impl SshManager {
    pub fn new() -> Self {
        Self
    }

    pub fn list_alive_ids(&self) -> Vec<String> {
        Vec::new()
    }

    pub fn kill_all(&self, _budget: &TerminalBudget) {}
}

impl Default for SshManager {
    fn default() -> Self {
        Self::new()
    }
}

fn unavailable() -> String {
    "SSH support is not compiled into this build (enable Cargo feature `ssh`)".into()
}

#[tauri::command]
pub async fn ssh_open(
    _budget: State<'_, TerminalBudget>,
    _terminal_id: String,
    _host_id: String,
    _cols: u16,
    _rows: u16,
) -> Result<SshOpenResult, String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn ssh_write(_terminal_id: String, _data: String) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn ssh_resize(
    _terminal_id: String,
    _cols: u16,
    _rows: u16,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub async fn ssh_close(
    _budget: State<'_, TerminalBudget>,
    _terminal_id: String,
) -> Result<(), String> {
    Err(unavailable())
}

#[tauri::command]
pub fn ssh_list() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}
