//! Main-window close policy + system tray (Phase 1).
//!
//! - Missing `[window]` ⇒ close quits, no tray (historical behavior).
//! - `closeAction=hide` + `trayEnabled=true` + tray available ⇒ hide on close.
//! - Tray left-click / menu "Show hip" ⇒ show main window.
//! - Tray menu "Quit" / `window_quit` / Cmd+Q ⇒ full exit (ExitRequested cleanup).
//! - `HIP_TRAY=0` forces legacy always-quit (no tray).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, State,
};

use crate::hip_config::{TomlHipConfig, WindowConfig};
use crate::paths;

const TRAY_ID: &str = "hip-main-tray";

/// Runtime policy managed by the shell.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicyDto {
    pub close_action: String,
    pub tray_enabled: bool,
    /// True when a tray icon is currently installed.
    pub tray_available: bool,
    /// Effective: hide on chrome close.
    pub should_hide_on_close: bool,
}

#[derive(Debug, Clone)]
pub struct WindowPolicy {
    pub close_action: String,
    pub tray_enabled: bool,
    pub tray_available: bool,
}

impl Default for WindowPolicy {
    fn default() -> Self {
        Self {
            close_action: "quit".into(),
            tray_enabled: false,
            tray_available: false,
        }
    }
}

impl WindowPolicy {
    pub fn should_hide_on_close(&self) -> bool {
        if env_tray_disabled() {
            return false;
        }
        self.tray_enabled && self.tray_available && self.close_action == "hide"
    }

    pub fn to_dto(&self) -> WindowPolicyDto {
        WindowPolicyDto {
            close_action: self.close_action.clone(),
            tray_enabled: self.tray_enabled,
            tray_available: self.tray_available,
            should_hide_on_close: self.should_hide_on_close(),
        }
    }
}

pub struct WindowPolicyState(pub Mutex<WindowPolicy>);

pub struct TrayState(pub Mutex<Option<TrayIcon>>);

fn env_tray_disabled() -> bool {
    matches!(
        std::env::var("HIP_TRAY").as_deref(),
        Ok("0") | Ok("false") | Ok("off")
    )
}

fn normalize_close_action(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("hide") => "hide".into(),
        Some("ask") => "ask".into(), // Phase 2; P1 treats as quit for close path
        Some("quit") | None => "quit".into(),
        Some(_) => "quit".into(),
    }
}

/// Phase 1: `ask` does not hide (no dialog yet) — behaves like quit on close.
fn close_action_hides(action: &str) -> bool {
    action == "hide"
}

pub fn policy_from_window_config(cfg: Option<&WindowConfig>) -> WindowPolicy {
    let (close_action, tray_enabled) = match cfg {
        Some(w) => (
            normalize_close_action(w.close_action.as_deref()),
            w.tray_enabled.unwrap_or(false),
        ),
        None => ("quit".into(), false),
    };
    WindowPolicy {
        close_action,
        tray_enabled: tray_enabled && !env_tray_disabled(),
        tray_available: false,
    }
}

pub fn load_policy_from_disk(app: &AppHandle) -> WindowPolicy {
    let Some(path) = paths::hip_config_path(app) else {
        return WindowPolicy::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return WindowPolicy::default();
    };
    let Ok(toml_cfg) = toml::from_str::<TomlHipConfig>(&raw) else {
        return WindowPolicy::default();
    };
    let hip: crate::hip_config::HipConfig = toml_cfg.into();
    policy_from_window_config(hip.window.as_ref())
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn build_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let show_i = MenuItem::with_id(app, "show", "Show hip", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&show_i, &quit_i])
}

/// Create or rebuild the tray icon from current policy. Updates `tray_available`.
pub fn sync_tray(app: &AppHandle) {
    if env_tray_disabled() {
        remove_tray(app);
        if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
            p.tray_enabled = false;
            p.tray_available = false;
        }
        return;
    }

    let want_tray = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map(|p| p.tray_enabled)
        .unwrap_or(false);

    if !want_tray {
        remove_tray(app);
        if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
            p.tray_available = false;
        }
        return;
    }

    // Already have a tray?
    {
        let has = app
            .state::<TrayState>()
            .0
            .lock()
            .map(|t| t.is_some())
            .unwrap_or(false);
        if has {
            if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
                p.tray_available = true;
            }
            return;
        }
    }

    match try_create_tray(app) {
        Ok(tray) => {
            if let Ok(mut slot) = app.state::<TrayState>().0.lock() {
                *slot = Some(tray);
            }
            if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
                p.tray_available = true;
            }
            println!("[tauri] system tray ready");
        }
        Err(e) => {
            eprintln!("[tauri] system tray failed: {e}");
            if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
                p.tray_available = false;
            }
        }
    }
}

fn try_create_tray_inner(app: &AppHandle) -> Result<TrayIcon, String> {
    let menu = build_tray_menu(app).map_err(|e| e.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no default window icon for tray".to_string())?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("hip")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    builder.build(app).map_err(|e| e.to_string())
}

fn try_create_tray(app: &AppHandle) -> Result<TrayIcon, String> {
    try_create_tray_inner(app)
}

fn remove_tray(app: &AppHandle) {
    if let Ok(mut slot) = app.state::<TrayState>().0.lock() {
        if let Some(tray) = slot.take() {
            let _ = tray.set_visible(false);
            // Drop removes the tray icon.
            drop(tray);
        }
    }
    // Also remove by id if present
    if let Some(existing) = app.tray_by_id(TRAY_ID) {
        let _ = existing.set_visible(false);
    }
}

/// Apply policy from FE (hot update). Recreates tray if needed.
pub fn apply_policy(app: &AppHandle, close_action: String, tray_enabled: bool) {
    let action = normalize_close_action(Some(&close_action));
    let enabled = tray_enabled && !env_tray_disabled();
    if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
        p.close_action = action;
        p.tray_enabled = enabled;
        p.tray_available = false;
    }
    // Rebuild tray when enabling; remove when disabling.
    remove_tray(app);
    sync_tray(app);
}

pub fn handle_close_requested(app: &AppHandle, api: tauri::CloseRequestApi) {
    let should_hide = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map(|p| {
            p.tray_enabled
                && p.tray_available
                && close_action_hides(&p.close_action)
                && !env_tray_disabled()
        })
        .unwrap_or(false);

    if should_hide {
        api.prevent_close();
        // Ensure tray exists (e.g. user enabled hide without tray race).
        sync_tray(app);
        let still_ok = app
            .state::<WindowPolicyState>()
            .0
            .lock()
            .map(|p| p.tray_available)
            .unwrap_or(false);
        if still_ok {
            hide_main_window(app);
        } else {
            // No tray → fall back to quit so the user is not stuck.
            app.exit(0);
        }
    } else {
        app.exit(0);
    }
}

// ── Tauri commands ───────────────────────────────────────────────

#[tauri::command]
pub fn window_get_policy(state: State<'_, WindowPolicyState>) -> Result<WindowPolicyDto, String> {
    let p = state
        .0
        .lock()
        .map_err(|e| format!("policy lock: {e}"))?
        .clone();
    Ok(p.to_dto())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSetPolicyArgs {
    pub close_action: String,
    pub tray_enabled: bool,
}

#[tauri::command]
pub fn window_set_policy(
    app: AppHandle,
    args: WindowSetPolicyArgs,
) -> Result<WindowPolicyDto, String> {
    apply_policy(&app, args.close_action, args.tray_enabled);
    let p = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map_err(|e| format!("policy lock: {e}"))?
        .clone();
    Ok(p.to_dto())
}

#[tauri::command]
pub fn window_show_main(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn window_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hip_config::WindowConfig;

    #[test]
    fn default_policy_is_quit_no_tray() {
        let p = policy_from_window_config(None);
        assert_eq!(p.close_action, "quit");
        assert!(!p.tray_enabled);
        assert!(!p.should_hide_on_close());
    }

    #[test]
    fn hide_requires_tray_available() {
        let mut p = policy_from_window_config(Some(&WindowConfig {
            close_action: Some("hide".into()),
            tray_enabled: Some(true),
            tray_always_visible: None,
            close_prompt_seen: None,
            launch_at_login: None,
            notify_on_agent_complete: None,
        }));
        assert!(!p.should_hide_on_close()); // tray not available yet
        p.tray_available = true;
        assert!(p.should_hide_on_close());
    }

    #[test]
    fn ask_does_not_hide_in_phase1() {
        let mut p = policy_from_window_config(Some(&WindowConfig {
            close_action: Some("ask".into()),
            tray_enabled: Some(true),
            tray_always_visible: None,
            close_prompt_seen: None,
            launch_at_login: None,
            notify_on_agent_complete: None,
        }));
        p.tray_available = true;
        assert!(!close_action_hides(&p.close_action));
        assert!(!p.should_hide_on_close());
    }

    #[test]
    fn normalize_unknown_to_quit() {
        assert_eq!(normalize_close_action(Some("minimize")), "quit");
        assert_eq!(normalize_close_action(Some("HIDE")), "hide");
    }
}
