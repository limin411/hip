//! Automation catalog + runs log (`~/.hip/automations/{catalog,runs}.json`).
//!
//! Product content directory (like work-items), not under `config/`.
//! IPC: list/save catalog and list/save runs with flat payloads.
//!
//! Unreadable files are **never moved away**: `dev` and packaged builds share
//! one `~/.hip`, so a build that predates a schema change must not be able to
//! erase the other side's data. On a parse failure the entries this build can
//! read are recovered and a `<name>.recovered-<ts>` copy of the original is
//! kept, so nothing is lost at rest.

use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;
use tauri::AppHandle;
use tauri::Emitter;

/// Highest catalog schema this build can interpret.
///
/// **Bump this on any incompatible change** (new trigger variant, new required
/// field, renamed key). A file whose `version` is higher is left untouched by
/// older builds — not loaded, not quarantined, not overwritten — so upgrading
/// again restores the user's tasks.
pub const SUPPORTED_CATALOG_VERSION: u32 = 1;
/// Highest runs-log schema this build can interpret (same contract as above).
pub const SUPPORTED_RUNS_LOG_VERSION: u32 = 1;

const NAME_MAX: usize = 200;
/// Prompt max size in UTF-8 **bytes** (256 KiB). Matches domain `AUTOMATION_PROMPT_MAX`.
const PROMPT_MAX: usize = 256 * 1024;
const SKILL_IDS_MAX: usize = 20;
/// Hard cap on serialized body (reject oversized saves).
const BODY_MAX_BYTES: usize = 20 * 1024 * 1024;

// ── Types (camelCase wire; match `src/domain/automations/types.ts`) ──────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutomationTrigger {
    Manual,
    // Enum-level `rename_all` only renames variant names, not their fields —
    // without this the wire key would be `interval_minutes` and the TS side
    // (`intervalMinutes`) would silently read undefined.
    #[serde(rename_all = "camelCase")]
    Interval {
        interval_minutes: i64,
    },
    Daily {
        hour: i64,
        minute: i64,
    },
    Weekly {
        weekday: i64,
        hour: i64,
        minute: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub enabled: bool,
    pub trigger: AutomationTrigger,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    pub status: String,
    pub trigger: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub started_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationsCatalog {
    pub version: u32,
    #[serde(default)]
    pub automations: Vec<Automation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunsLog {
    pub version: u32,
    #[serde(default)]
    pub runs: Vec<AutomationRun>,
}

pub fn default_catalog() -> AutomationsCatalog {
    AutomationsCatalog {
        version: 1,
        automations: vec![],
    }
}

pub fn default_runs_log() -> AutomationRunsLog {
    AutomationRunsLog {
        version: 1,
        runs: vec![],
    }
}

// ── Validation ───────────────────────────────────────────────────────────────

fn is_automation_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("auto_") else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn is_automation_run_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("arun_") else {
        return false;
    };
    !rest.is_empty()
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn is_run_status(s: &str) -> bool {
    matches!(
        s,
        "pending"
            | "running"
            | "waiting_user"
            | "succeeded"
            | "failed"
            | "skipped"
            | "cancelled"
    )
}

fn is_run_trigger(s: &str) -> bool {
    matches!(s, "manual" | "schedule" | "catchup")
}

fn is_permission_mode(s: &str) -> bool {
    matches!(s, "chat" | "edit" | "full")
}

fn validate_trigger(t: &AutomationTrigger, auto_id: &str) -> Result<(), String> {
    match t {
        AutomationTrigger::Manual => Ok(()),
        AutomationTrigger::Interval { interval_minutes } => {
            // 1 minute floor (host tick ~30s); 1 year ceiling bounds nextRunAt.
            if !(1..=525600).contains(interval_minutes) {
                return Err(format!(
                    "invalid interval_minutes on {auto_id}: {interval_minutes}"
                ));
            }
            Ok(())
        }
        AutomationTrigger::Daily { hour, minute } => {
            if !(0..=23).contains(hour) {
                return Err(format!("invalid hour on {auto_id}: {hour}"));
            }
            if !(0..=59).contains(minute) {
                return Err(format!("invalid minute on {auto_id}: {minute}"));
            }
            Ok(())
        }
        AutomationTrigger::Weekly {
            weekday,
            hour,
            minute,
        } => {
            if !(0..=6).contains(weekday) {
                return Err(format!("invalid weekday on {auto_id}: {weekday}"));
            }
            if !(0..=23).contains(hour) {
                return Err(format!("invalid hour on {auto_id}: {hour}"));
            }
            if !(0..=59).contains(minute) {
                return Err(format!("invalid minute on {auto_id}: {minute}"));
            }
            Ok(())
        }
    }
}

/// Validate catalog before save (Rust is the authority for persist).
pub fn validate_catalog(catalog: &AutomationsCatalog) -> Result<(), String> {
    if catalog.version != SUPPORTED_CATALOG_VERSION {
        return Err(format!("unsupported catalog version {}", catalog.version));
    }

    let mut ids = std::collections::HashSet::new();
    for auto in &catalog.automations {
        if !is_automation_id(&auto.id) {
            return Err(format!("invalid automation id: {}", auto.id));
        }
        if !ids.insert(auto.id.clone()) {
            return Err(format!("duplicate automation id: {}", auto.id));
        }
        if auto.name.chars().count() > NAME_MAX {
            return Err(format!("name too long: {}", auto.id));
        }
        if auto.prompt.len() > PROMPT_MAX {
            return Err(format!("prompt too long: {}", auto.id));
        }
        validate_trigger(&auto.trigger, &auto.id)?;
        if let Some(mode) = auto.permission_mode.as_deref() {
            if !is_permission_mode(mode) {
                return Err(format!("invalid permissionMode on {}: {mode}", auto.id));
            }
        }
        if let Some(skills) = &auto.skill_ids {
            if skills.len() > SKILL_IDS_MAX {
                return Err(format!("too many skillIds on {}", auto.id));
            }
        }
        if let Some(status) = auto.last_status.as_deref() {
            if !is_run_status(status) {
                return Err(format!("invalid lastStatus on {}: {status}", auto.id));
            }
        }
    }
    Ok(())
}

/// Validate runs log before save.
pub fn validate_runs_log(log: &AutomationRunsLog) -> Result<(), String> {
    if log.version != SUPPORTED_RUNS_LOG_VERSION {
        return Err(format!("unsupported runs log version {}", log.version));
    }

    let mut ids = std::collections::HashSet::new();
    for run in &log.runs {
        if !is_automation_run_id(&run.id) {
            return Err(format!("invalid run id: {}", run.id));
        }
        if !ids.insert(run.id.clone()) {
            return Err(format!("duplicate run id: {}", run.id));
        }
        if !is_automation_id(&run.automation_id) {
            return Err(format!(
                "invalid automationId on {}: {}",
                run.id, run.automation_id
            ));
        }
        if !is_run_status(&run.status) {
            return Err(format!("invalid status on {}: {}", run.id, run.status));
        }
        if !is_run_trigger(&run.trigger) {
            return Err(format!("invalid trigger on {}: {}", run.id, run.trigger));
        }
    }
    Ok(())
}

// ── Load / save ──────────────────────────────────────────────────────────────

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Read only the `version` field of a catalog/log body.
fn probe_version(body: &str) -> Option<u32> {
    #[derive(Deserialize)]
    struct Probe {
        #[serde(default)]
        version: u32,
    }
    serde_json::from_str::<Probe>(body).ok().map(|p| p.version)
}

/// `version` recorded on disk (`None` when missing or unreadable).
fn on_disk_version(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|body| probe_version(&body))
}

/// Best-effort recovery for a body that failed to deserialize as a whole:
/// keep the entries that do parse. An unreadable body is usually a *newer*
/// schema, so a partial view is better than an empty one.
fn salvage_entries<T: serde::de::DeserializeOwned>(body: &str, field: &str) -> Option<Vec<T>> {
    let root: serde_json::Value = serde_json::from_str(body).ok()?;
    let entries = root.get(field)?.as_array()?;
    let mut kept = Vec::with_capacity(entries.len());
    let mut skipped = 0usize;
    for entry in entries {
        match serde_json::from_value::<T>(entry.clone()) {
            Ok(v) => kept.push(v),
            Err(_) => skipped += 1,
        }
    }
    if skipped > 0 {
        eprintln!(
            "[tauri] automations: {field}: recovered {} entry(ies), skipped {skipped} this build cannot read",
            kept.len()
        );
    }
    Some(kept)
}

/// Copy an unreadable file aside as `<name>.recovered-<ts>`.
///
/// The original is deliberately **left in place**: moving it away is what made
/// automations vanish for every build at once. The copy exists so a later save
/// by this (older) build cannot destroy the entries it could not read.
fn preserve_unreadable_copy(path: &Path, basename: &str) {
    let copy = path.with_file_name(format!("{basename}.recovered-{}", now_ms()));
    match std::fs::copy(path, &copy) {
        Ok(_) => eprintln!(
            "[tauri] automations: unreadable file left in place; copy at {}",
            copy.display()
        ),
        Err(e) => eprintln!("[tauri] automations: failed to copy unreadable file: {e}"),
    }
}

/// Load catalog. Missing → empty. Unreadable → recover what this build can read
/// and keep the original file on disk.
pub fn load_catalog(path: &Path) -> AutomationsCatalog {
    let body = match std::fs::read_to_string(path) {
        Ok(body) => body,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return default_catalog(),
        Err(e) => {
            eprintln!(
                "[tauri] automations: read catalog failed ({}): {e}",
                path.display()
            );
            return default_catalog();
        }
    };
    if let Some(v) = probe_version(&body) {
        if v > SUPPORTED_CATALOG_VERSION {
            eprintln!(
                "[tauri] automations: catalog v{v} was written by a newer hip (this build reads up to v{SUPPORTED_CATALOG_VERSION}); leaving the file untouched",
            );
            return default_catalog();
        }
    }
    match serde_json::from_str::<AutomationsCatalog>(&body) {
        Ok(cat) => cat,
        Err(e) => {
            eprintln!(
                "[tauri] automations: catalog parse failed ({}): {e}",
                path.display()
            );
            preserve_unreadable_copy(path, "catalog.json");
            AutomationsCatalog {
                version: SUPPORTED_CATALOG_VERSION,
                automations: salvage_entries::<Automation>(&body, "automations").unwrap_or_default(),
            }
        }
    }
}

/// Load runs log. Missing → empty. Unreadable → recover what this build can read
/// and keep the original file on disk.
pub fn load_runs_log(path: &Path) -> AutomationRunsLog {
    let body = match std::fs::read_to_string(path) {
        Ok(body) => body,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return default_runs_log(),
        Err(e) => {
            eprintln!(
                "[tauri] automations: read runs failed ({}): {e}",
                path.display()
            );
            return default_runs_log();
        }
    };
    if let Some(v) = probe_version(&body) {
        if v > SUPPORTED_RUNS_LOG_VERSION {
            eprintln!(
                "[tauri] automations: runs log v{v} was written by a newer hip (this build reads up to v{SUPPORTED_RUNS_LOG_VERSION}); leaving the file untouched",
            );
            return default_runs_log();
        }
    }
    match serde_json::from_str::<AutomationRunsLog>(&body) {
        Ok(log) => log,
        Err(e) => {
            eprintln!(
                "[tauri] automations: runs log parse failed ({}): {e}",
                path.display()
            );
            preserve_unreadable_copy(path, "runs.json");
            AutomationRunsLog {
                version: SUPPORTED_RUNS_LOG_VERSION,
                runs: salvage_entries::<AutomationRun>(&body, "runs").unwrap_or_default(),
            }
        }
    }
}

/// Persist catalog via shared atomic 0o600 helper.
pub fn save_catalog(path: &Path, catalog: &AutomationsCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
    if let Some(v) = on_disk_version(path) {
        if v > SUPPORTED_CATALOG_VERSION {
            return Err(format!(
                "refusing to overwrite automations catalog v{v} (this hip build writes v{SUPPORTED_CATALOG_VERSION})"
            ));
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(catalog).map_err(|e| e.to_string())?;
    if body.len() > BODY_MAX_BYTES {
        return Err(format!(
            "catalog too large: {} bytes (max {BODY_MAX_BYTES})",
            body.len()
        ));
    }
    crate::atomic_write::atomic_write_private(path, body.as_bytes()).map_err(|e| e.to_string())
}

/// Persist runs log via shared atomic 0o600 helper.
pub fn save_runs_log(path: &Path, log: &AutomationRunsLog) -> Result<(), String> {
    validate_runs_log(log)?;
    if let Some(v) = on_disk_version(path) {
        if v > SUPPORTED_RUNS_LOG_VERSION {
            return Err(format!(
                "refusing to overwrite runs log v{v} (this hip build writes v{SUPPORTED_RUNS_LOG_VERSION})"
            ));
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(log).map_err(|e| e.to_string())?;
    if body.len() > BODY_MAX_BYTES {
        return Err(format!(
            "runs log too large: {} bytes (max {BODY_MAX_BYTES})",
            body.len()
        ));
    }
    crate::atomic_write::atomic_write_private(path, body.as_bytes()).map_err(|e| e.to_string())
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Load catalog. Missing/corrupt → empty default (parent dir created via paths).
#[tauri::command]
pub fn automations_list(app: AppHandle) -> Result<AutomationsCatalog, String> {
    let path = crate::paths::automations_catalog_path(&app)
        .ok_or_else(|| "no automations dir".to_string())?;
    Ok(load_catalog(&path))
}

/// Full replace save of the automations catalog.
#[tauri::command]
pub fn automations_save(app: AppHandle, catalog: AutomationsCatalog) -> Result<(), String> {
    let path = crate::paths::automations_catalog_path(&app)
        .ok_or_else(|| "no automations dir".to_string())?;
    save_catalog(&path, &catalog)
}

/// Load runs log. Missing/corrupt → empty default.
#[tauri::command]
pub fn automation_runs_list(app: AppHandle) -> Result<AutomationRunsLog, String> {
    let path = crate::paths::automations_runs_path(&app)
        .ok_or_else(|| "no automations dir".to_string())?;
    Ok(load_runs_log(&path))
}

/// Full replace save of the automation runs log.
#[tauri::command]
pub fn automation_runs_save(app: AppHandle, log: AutomationRunsLog) -> Result<(), String> {
    let path = crate::paths::automations_runs_path(&app)
        .ok_or_else(|| "no automations dir".to_string())?;
    save_runs_log(&path, &log)
}

// ── Schedule ticker ──────────────────────────────────────────────────────────

/// Event the native ticker emits so the frontend re-evaluates due automations.
pub const SCHEDULE_TICK_EVENT: &str = "automation://tick";

/// Tick cadence in seconds — schedule precision is ± this window.
pub const SCHEDULE_TICK_SECS: u64 = 30;

/// Own the automation schedule tick from the **native** runtime rather than the
/// webview.
///
/// WebView2 throttles (and can effectively stall) `setInterval` while the main
/// window is hidden to tray or minimized, which silently disabled every
/// scheduled automation. A tokio timer lives outside the renderer, so it keeps
/// firing regardless of window visibility. The webview only has to handle the
/// event, and event delivery is not subject to timer throttling.
pub fn spawn_schedule_ticker(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(SCHEDULE_TICK_SECS)).await;
            if app.emit(SCHEDULE_TICK_EVENT, ()).is_err() {
                // App is shutting down: a handle that can never deliver again
                // is not worth spinning on.
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hip-automations-test-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn catalog_path(name: &str) -> PathBuf {
        tmp_dir(name).join("catalog.json")
    }

    fn runs_path(name: &str) -> PathBuf {
        tmp_dir(name).join("runs.json")
    }

    fn sample_auto() -> Automation {
        Automation {
            id: "auto_abc123".into(),
            name: "Morning standup".into(),
            prompt: "Summarize my day.".into(),
            enabled: true,
            trigger: AutomationTrigger::Daily {
                hour: 9,
                minute: 0,
            },
            session_id: None,
            project_path: Some("/Users/me/proj".into()),
            llm_provider: Some("openai".into()),
            model: Some("gpt-4o".into()),
            agent_id: None,
            effort: None,
            permission_mode: Some("chat".into()),
            skill_ids: Some(vec!["skill_a".into()]),
            template_id: None,
            created_at: 1_720_000_001_000,
            updated_at: 1_720_000_002_000,
            last_run_at: Some(1_720_000_003_000),
            last_status: Some("succeeded".into()),
            last_error: None,
            last_session_id: Some("sess_1".into()),
            next_run_at: Some(1_720_000_100_000),
        }
    }

    fn sample_catalog() -> AutomationsCatalog {
        AutomationsCatalog {
            version: 1,
            automations: vec![sample_auto()],
        }
    }

    fn sample_run() -> AutomationRun {
        AutomationRun {
            id: "arun_xyz789".into(),
            automation_id: "auto_abc123".into(),
            status: "succeeded".into(),
            trigger: "schedule".into(),
            session_id: Some("sess_1".into()),
            started_at: 1_720_000_003_000,
            finished_at: Some(1_720_000_004_000),
            error: None,
        }
    }

    fn sample_runs_log() -> AutomationRunsLog {
        AutomationRunsLog {
            version: 1,
            runs: vec![sample_run()],
        }
    }

    #[test]
    fn missing_catalog_loads_empty() {
        let p = std::env::temp_dir().join(format!(
            "hip-automations-missing-{}-xyz.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        let cat = load_catalog(&p);
        assert_eq!(cat, default_catalog());
    }

    #[test]
    fn missing_runs_loads_empty() {
        let p = std::env::temp_dir().join(format!(
            "hip-automations-runs-missing-{}-xyz.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&p);
        let log = load_runs_log(&p);
        assert_eq!(log, default_runs_log());
    }

    #[test]
    fn unreadable_catalog_returns_default_and_keeps_the_original() {
        let p = fresh_dir("corrupt-cat").join("catalog.json");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        let cat = load_catalog(&p);
        assert_eq!(cat, default_catalog());
        assert!(
            p.exists(),
            "the original must stay put — renaming it away is what made tasks disappear"
        );
        assert_eq!(recovered_copies(&p).len(), 1);
    }

    #[test]
    fn unreadable_runs_returns_default_and_keeps_the_original() {
        let p = fresh_dir("corrupt-runs").join("runs.json");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        let log = load_runs_log(&p);
        assert_eq!(log, default_runs_log());
        assert!(p.exists(), "the original must stay put");
        assert_eq!(recovered_copies(&p).len(), 1);
    }

    #[test]
    fn save_load_catalog_roundtrip() {
        let p = catalog_path("roundtrip-cat");
        let _ = std::fs::remove_file(&p);
        let cat = sample_catalog();
        save_catalog(&p, &cat).unwrap();
        let loaded = load_catalog(&p);
        assert_eq!(loaded, cat);
    }

    #[test]
    fn save_load_runs_roundtrip() {
        let p = runs_path("roundtrip-runs");
        let _ = std::fs::remove_file(&p);
        let log = sample_runs_log();
        save_runs_log(&p, &log).unwrap();
        let loaded = load_runs_log(&p);
        assert_eq!(loaded, log);
    }

    #[test]
    #[cfg(unix)]
    fn catalog_file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = catalog_path("perms-cat");
        let _ = std::fs::remove_file(&p);
        save_catalog(&p, &default_catalog()).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    #[cfg(unix)]
    fn runs_file_is_0600_after_write() {
        use std::os::unix::fs::PermissionsExt;
        let p = runs_path("perms-runs");
        let _ = std::fs::remove_file(&p);
        save_runs_log(&p, &default_runs_log()).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn rejects_bad_catalog_version() {
        let mut cat = default_catalog();
        cat.version = 2;
        assert!(validate_catalog(&cat).is_err());
    }

    #[test]
    fn rejects_bad_automation_id() {
        let mut cat = sample_catalog();
        cat.automations[0].id = "task_1".into();
        assert!(validate_catalog(&cat)
            .unwrap_err()
            .contains("invalid automation id"));
    }

    #[test]
    fn rejects_duplicate_automation_id() {
        let mut cat = sample_catalog();
        cat.automations.push(sample_auto());
        assert!(validate_catalog(&cat)
            .unwrap_err()
            .contains("duplicate automation id"));
    }

    #[test]
    fn rejects_oversized_name_and_prompt() {
        let mut cat = sample_catalog();
        cat.automations[0].name = "x".repeat(NAME_MAX + 1);
        assert!(validate_catalog(&cat).unwrap_err().contains("name too long"));

        cat = sample_catalog();
        cat.automations[0].prompt = "n".repeat(PROMPT_MAX + 1);
        assert!(validate_catalog(&cat)
            .unwrap_err()
            .contains("prompt too long"));
    }

    #[test]
    fn interval_trigger_uses_camel_case_wire_and_rejects_zero() {
        let t = AutomationTrigger::Interval {
            interval_minutes: 30,
        };
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["kind"], "interval");
        assert_eq!(json["intervalMinutes"], 30);
        assert!(validate_trigger(&t, "auto_x").is_ok());
        assert!(
            validate_trigger(
                &AutomationTrigger::Interval {
                    interval_minutes: 0
                },
                "auto_x"
            )
            .unwrap_err()
            .contains("invalid interval_minutes")
        );
    }

    #[test]
    fn rejects_invalid_trigger_ranges() {
        let mut cat = sample_catalog();
        cat.automations[0].trigger = AutomationTrigger::Interval {
            interval_minutes: 0,
        };
        assert!(
            validate_catalog(&cat)
                .unwrap_err()
                .contains("invalid interval_minutes"),
            "a zero interval must not reach disk (it would fire on every tick)"
        );

        cat = sample_catalog();
        cat.automations[0].trigger = AutomationTrigger::Daily {
            hour: 24,
            minute: 0,
        };
        assert!(validate_catalog(&cat).unwrap_err().contains("invalid hour"));

        cat = sample_catalog();
        cat.automations[0].trigger = AutomationTrigger::Weekly {
            weekday: 7,
            hour: 9,
            minute: 0,
        };
        assert!(validate_catalog(&cat)
            .unwrap_err()
            .contains("invalid weekday"));
    }

    #[test]
    fn rejects_bad_run_id_and_status() {
        let mut log = sample_runs_log();
        log.runs[0].id = "run_1".into();
        assert!(validate_runs_log(&log)
            .unwrap_err()
            .contains("invalid run id"));

        log = sample_runs_log();
        log.runs[0].status = "done".into();
        assert!(validate_runs_log(&log)
            .unwrap_err()
            .contains("invalid status"));

        log = sample_runs_log();
        log.runs[0].trigger = "cron".into();
        assert!(validate_runs_log(&log)
            .unwrap_err()
            .contains("invalid trigger"));
    }

    #[test]
    fn serde_camel_case_wire_shape() {
        let cat = sample_catalog();
        let json = serde_json::to_value(&cat).unwrap();
        let auto = &json["automations"][0];
        assert!(auto.get("projectPath").is_some());
        assert!(auto.get("createdAt").is_some());
        assert!(auto.get("lastRunAt").is_some());
        assert!(auto.get("llmProvider").is_some());
        assert!(auto.get("skillIds").is_some());
        assert_eq!(auto["trigger"]["kind"], "daily");
        assert_eq!(auto["trigger"]["hour"], 9);

        let log = sample_runs_log();
        let rjson = serde_json::to_value(&log).unwrap();
        let run = &rjson["runs"][0];
        assert!(run.get("automationId").is_some());
        assert!(run.get("startedAt").is_some());
        assert!(run.get("sessionId").is_some());
    }

    #[test]
    fn weekly_and_manual_triggers_roundtrip() {
        let p = catalog_path("triggers");
        let _ = std::fs::remove_file(&p);
        let mut cat = sample_catalog();
        cat.automations[0].trigger = AutomationTrigger::Manual;
        cat.automations.push(Automation {
            id: "auto_weekly1".into(),
            name: "Weekly".into(),
            prompt: "x".into(),
            enabled: false,
            trigger: AutomationTrigger::Weekly {
                weekday: 0,
                hour: 10,
                minute: 30,
            },
            session_id: None,
            project_path: None,
            llm_provider: None,
            model: None,
            agent_id: None,
            effort: None,
            permission_mode: None,
            skill_ids: None,
            template_id: None,
            created_at: 1,
            updated_at: 1,
            last_run_at: None,
            last_status: None,
            last_error: None,
            last_session_id: None,
            next_run_at: None,
        });
        save_catalog(&p, &cat).unwrap();
        let loaded = load_catalog(&p);
        assert_eq!(loaded, cat);
    }

    /// Test dir with no leftovers (a stale `.recovered-*` would break counting).
    fn fresh_dir(name: &str) -> PathBuf {
        let dir = tmp_dir(name);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        dir
    }

    fn recovered_copies(path: &Path) -> Vec<String> {
        let prefix = format!(
            "{}.recovered-",
            path.file_name().unwrap().to_string_lossy()
        );
        std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&prefix))
            .collect()
    }

    /// Regression: a build that predates a schema change read a newer catalog,
    /// called the whole file corrupt and renamed it away — every task vanished
    /// for both builds. Unknown entries must now be survivable.
    #[test]
    fn unreadable_entries_keep_file_and_recover_the_rest() {
        let p = fresh_dir("partial-recover").join("catalog.json");
        let mut value = serde_json::to_value(sample_catalog()).unwrap();
        value["automations"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "auto_future1",
                "name": "Future task",
                "prompt": "x",
                "enabled": true,
                "trigger": { "kind": "cronlike", "expr": "* * * * *" },
                "createdAt": 1,
                "updatedAt": 2
            }));
        let body = serde_json::to_string_pretty(&value).unwrap();
        std::fs::write(&p, &body).unwrap();

        let loaded = load_catalog(&p);
        assert_eq!(loaded.automations.len(), 1, "readable entries must still load");
        assert_eq!(loaded.automations[0].id, sample_auto().id);
        assert_eq!(loaded.version, SUPPORTED_CATALOG_VERSION);

        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            body,
            "the file must be neither moved nor rewritten"
        );
        assert_eq!(
            recovered_copies(&p).len(),
            1,
            "an untouched copy of the original must be kept"
        );
    }

    #[test]
    fn newer_catalog_version_is_neither_loaded_nor_overwritten() {
        let p = fresh_dir("newer-version").join("catalog.json");
        let mut value = serde_json::to_value(sample_catalog()).unwrap();
        value["version"] = serde_json::json!(SUPPORTED_CATALOG_VERSION + 1);
        let body = serde_json::to_string_pretty(&value).unwrap();
        std::fs::write(&p, &body).unwrap();

        assert!(
            load_catalog(&p).automations.is_empty(),
            "a newer schema must not be guessed at"
        );
        assert!(recovered_copies(&p).is_empty(), "a newer file is not corrupt");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), body);

        let err = save_catalog(&p, &sample_catalog()).unwrap_err();
        assert!(err.contains("refusing to overwrite"), "got: {err}");
        assert_eq!(
            std::fs::read_to_string(&p).unwrap(),
            body,
            "a refused save must leave the newer file intact"
        );
    }

    #[test]
    fn newer_runs_log_version_is_neither_loaded_nor_overwritten() {
        let p = fresh_dir("newer-runs-version").join("runs.json");
        let mut value = serde_json::to_value(sample_runs_log()).unwrap();
        value["version"] = serde_json::json!(SUPPORTED_RUNS_LOG_VERSION + 1);
        let body = serde_json::to_string_pretty(&value).unwrap();
        std::fs::write(&p, &body).unwrap();

        assert!(load_runs_log(&p).runs.is_empty());
        assert!(save_runs_log(&p, &sample_runs_log())
            .unwrap_err()
            .contains("refusing to overwrite"));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), body);
    }

    #[test]
    fn non_json_catalog_is_left_in_place() {
        let p = fresh_dir("not-json").join("catalog.json");
        std::fs::write(&p, "{\"version\": 1, \"automations\": [").unwrap();

        assert!(load_catalog(&p).automations.is_empty());
        assert!(p.exists(), "the file must survive a parse failure");
        assert_eq!(recovered_copies(&p).len(), 1);
    }
}
