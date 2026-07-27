//! Automation catalog + runs log (`~/.hip/automations/{catalog,runs}.json`).
//!
//! Product content directory (like work-items), not under `config/`.
//! IPC: list/save catalog and list/save runs with flat payloads.
//! Corrupt files are backed up as `<name>.corrupt-<ts>` (mirrors work-items).

use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

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
    if catalog.version != 1 {
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
    if log.version != 1 {
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

fn backup_corrupt(path: &Path, basename: &str) -> Option<PathBuf> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup_name = format!("{basename}.corrupt-{ts}");
    let backup = path.with_file_name(backup_name);
    match std::fs::rename(path, &backup) {
        Ok(()) => {
            eprintln!(
                "[tauri] automations: backed up corrupt file to {}",
                backup.display()
            );
            Some(backup)
        }
        Err(e) => {
            eprintln!("[tauri] automations: failed to backup corrupt file: {e}");
            None
        }
    }
}

/// Load catalog. Missing → empty. Corrupt → backup + empty.
pub fn load_catalog(path: &Path) -> AutomationsCatalog {
    match std::fs::read_to_string(path) {
        Ok(body) => match serde_json::from_str::<AutomationsCatalog>(&body) {
            Ok(cat) => cat,
            Err(_) => {
                let _ = backup_corrupt(path, "catalog.json");
                default_catalog()
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => default_catalog(),
        Err(e) => {
            eprintln!("[tauri] automations: read catalog failed ({}): {e}", path.display());
            default_catalog()
        }
    }
}

/// Load runs log. Missing → empty. Corrupt → backup + empty.
pub fn load_runs_log(path: &Path) -> AutomationRunsLog {
    match std::fs::read_to_string(path) {
        Ok(body) => match serde_json::from_str::<AutomationRunsLog>(&body) {
            Ok(log) => log,
            Err(_) => {
                let _ = backup_corrupt(path, "runs.json");
                default_runs_log()
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => default_runs_log(),
        Err(e) => {
            eprintln!("[tauri] automations: read runs failed ({}): {e}", path.display());
            default_runs_log()
        }
    }
}

/// Persist catalog via shared atomic 0o600 helper.
pub fn save_catalog(path: &Path, catalog: &AutomationsCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
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
    fn corrupt_catalog_backed_up_and_returns_default() {
        let p = catalog_path("corrupt-cat");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        let cat = load_catalog(&p);
        assert_eq!(cat, default_catalog());
        assert!(!p.exists(), "corrupt original should be renamed away");
        let parent = p.parent().unwrap();
        let backups: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("catalog.json.corrupt-"))
            .collect();
        assert!(
            !backups.is_empty(),
            "expected catalog.json.corrupt-<ts> backup"
        );
    }

    #[test]
    fn corrupt_runs_backed_up_and_returns_default() {
        let p = runs_path("corrupt-runs");
        std::fs::write(&p, b"not-json{{{{").unwrap();
        let log = load_runs_log(&p);
        assert_eq!(log, default_runs_log());
        assert!(!p.exists(), "corrupt original should be renamed away");
        let parent = p.parent().unwrap();
        let backups: Vec<_> = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("runs.json.corrupt-"))
            .collect();
        assert!(
            !backups.is_empty(),
            "expected runs.json.corrupt-<ts> backup"
        );
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
    fn rejects_invalid_trigger_ranges() {
        let mut cat = sample_catalog();
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
}
