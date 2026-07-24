//! Main-window close policy + system tray (Phase 1–2).
//!
//! Phase 1: hide vs quit, tray show/quit, single-instance (see lib.rs).
//! Phase 2: first-close / ask dialog, exit confirm via FE, tray tooltip status.
//!
//! - Missing `[window]` ⇒ close quits, no tray (historical behavior).
//! - `closeAction=hide` + tray ⇒ hide on close (after first-close prompt when unseen).
//! - `closeAction=ask` or `closePromptSeen=false` ⇒ FE close dialog.
//! - Quit paths (close/quit menu/Cmd+Q) go through ExitRequested; unless
//!   `force_quit`, FE gets `window://exit-confirm` and decides.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State,
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
    /// Effective: hide on chrome close (no ask / first-prompt).
    pub should_hide_on_close: bool,
    pub close_prompt_seen: bool,
}

#[derive(Debug, Clone)]
pub struct WindowPolicy {
    pub close_action: String,
    pub tray_enabled: bool,
    pub tray_available: bool,
    pub close_prompt_seen: bool,
}

impl Default for WindowPolicy {
    fn default() -> Self {
        Self {
            close_action: "quit".into(),
            tray_enabled: false,
            tray_available: false,
            close_prompt_seen: false,
        }
    }
}

impl WindowPolicy {
    pub fn should_hide_on_close(&self) -> bool {
        if env_tray_disabled() {
            return false;
        }
        self.tray_enabled
            && self.tray_available
            && close_action_hides(&self.close_action)
            && self.close_prompt_seen
    }

    pub fn needs_close_prompt(&self) -> bool {
        if env_tray_disabled() {
            return false;
        }
        !self.close_prompt_seen || self.close_action == "ask"
    }

    pub fn to_dto(&self) -> WindowPolicyDto {
        WindowPolicyDto {
            close_action: self.close_action.clone(),
            tray_enabled: self.tray_enabled,
            tray_available: self.tray_available,
            should_hide_on_close: self.should_hide_on_close(),
            close_prompt_seen: self.close_prompt_seen,
        }
    }
}

pub struct WindowPolicyState(pub Mutex<WindowPolicy>);

pub struct TrayState(pub Mutex<Option<TrayIcon>>);

/// When true, ExitRequested performs cleanup and does not ask FE.
pub struct QuitGuard {
    pub force: AtomicBool,
    /// Avoid re-emitting exit-confirm while FE dialog is open.
    pub exit_confirm_pending: AtomicBool,
}

impl Default for QuitGuard {
    fn default() -> Self {
        Self {
            force: AtomicBool::new(false),
            exit_confirm_pending: AtomicBool::new(false),
        }
    }
}

fn env_tray_disabled() -> bool {
    matches!(
        std::env::var("HIP_TRAY").as_deref(),
        Ok("0") | Ok("false") | Ok("off")
    )
}

fn normalize_close_action(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("hide") => "hide".into(),
        Some("ask") => "ask".into(),
        Some("quit") | None => "quit".into(),
        Some(_) => "quit".into(),
    }
}

fn close_action_hides(action: &str) -> bool {
    action == "hide"
}

pub fn policy_from_window_config(cfg: Option<&WindowConfig>) -> WindowPolicy {
    let (close_action, tray_enabled, close_prompt_seen) = match cfg {
        Some(w) => (
            normalize_close_action(w.close_action.as_deref()),
            w.tray_enabled.unwrap_or(false),
            w.close_prompt_seen.unwrap_or(false),
        ),
        None => ("quit".into(), false, false),
    };
    WindowPolicy {
        close_action,
        tray_enabled: tray_enabled && !env_tray_disabled(),
        tray_available: false,
        close_prompt_seen,
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
    let settings_i = MenuItem::with_id(app, "settings", "Open Settings", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&show_i, &settings_i, &quit_i])
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

/// Resolve tray image.
///
/// Important: hip's app icon is a **color** glyph (orange face). macOS
/// `icon_as_template(true)` turns every opaque pixel into a flat mono silhouette —
/// with our light rounded background that becomes an unreadable white blob.
/// Do **not** enable template mode unless we ship a true black-on-transparent
/// menu-bar template asset.
fn tray_icon_image() -> Result<tauri::image::Image<'static>, String> {
    // Mid-size PNG keeps face details readable at tray size.
    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
        .or_else(|_| tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")))
        .map_err(|e| format!("load tray icon: {e}"))
}

fn try_create_tray_inner(app: &AppHandle) -> Result<TrayIcon, String> {
    let menu = build_tray_menu(app).map_err(|e| e.to_string())?;
    let icon = tray_icon_image()?;

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        // Color app icon — not a macOS menu-bar template (see tray_icon_image).
        .icon_as_template(false)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("hip")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "settings" => {
                show_main_window(app);
                let _ = app.emit("window://open-settings", ());
            }
            "quit" => {
                // Ensure UI can show exit-confirm when work is running.
                show_main_window(app);
                app.exit(0);
            }
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

    builder.build(app).map_err(|e| e.to_string())
}

fn try_create_tray(app: &AppHandle) -> Result<TrayIcon, String> {
    try_create_tray_inner(app)
}

fn remove_tray(app: &AppHandle) {
    if let Ok(mut slot) = app.state::<TrayState>().0.lock() {
        if let Some(tray) = slot.take() {
            let _ = tray.set_visible(false);
            drop(tray);
        }
    }
    if let Some(existing) = app.tray_by_id(TRAY_ID) {
        let _ = existing.set_visible(false);
    }
}

/// Apply policy from FE (hot update). Recreates tray if needed.
pub fn apply_policy(
    app: &AppHandle,
    close_action: String,
    tray_enabled: bool,
    close_prompt_seen: Option<bool>,
) {
    let action = normalize_close_action(Some(&close_action));
    let enabled = tray_enabled && !env_tray_disabled();
    if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
        p.close_action = action;
        p.tray_enabled = enabled;
        p.tray_available = false;
        if let Some(seen) = close_prompt_seen {
            p.close_prompt_seen = seen;
        }
    }
    remove_tray(app);
    sync_tray(app);
}

fn perform_hide(app: &AppHandle) {
    sync_tray(app);
    let still_ok = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map(|p| p.tray_available)
        .unwrap_or(false);
    if still_ok {
        hide_main_window(app);
        let _ = app.emit("window://hidden", ());
    } else {
        // No tray → quit path so the user is not stuck.
        app.exit(0);
    }
}

pub fn handle_close_requested(app: &AppHandle, api: tauri::CloseRequestApi) {
    if env_tray_disabled() {
        app.exit(0);
        return;
    }

    let needs_prompt = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map(|p| p.needs_close_prompt())
        .unwrap_or(false);

    if needs_prompt {
        api.prevent_close();
        show_main_window(app);
        let _ = app.emit("window://close-prompt", ());
        return;
    }

    let should_hide = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map(|p| p.should_hide_on_close())
        .unwrap_or(false);

    if should_hide {
        api.prevent_close();
        perform_hide(app);
        return;
    }

    app.exit(0);
}

/// ExitRequested handler: unless force_quit, ask FE to confirm (active work).
/// Returns true if exit should proceed with cleanup.
pub fn handle_exit_requested(app: &AppHandle, api: &tauri::ExitRequestApi) -> bool {
    let guard = app.state::<QuitGuard>();
    if guard.force.load(Ordering::SeqCst) {
        return true;
    }
    api.prevent_exit();
    if guard
        .exit_confirm_pending
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        show_main_window(app);
        let _ = app.emit("window://exit-confirm", ());
        // Safety: if FE never responds (not mounted / hung), force quit after a few seconds.
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            let g = app2.state::<QuitGuard>();
            if g.exit_confirm_pending.load(Ordering::SeqCst) && !g.force.load(Ordering::SeqCst) {
                eprintln!("[tauri] exit-confirm timed out; forcing quit");
                g.force.store(true, Ordering::SeqCst);
                g.exit_confirm_pending.store(false, Ordering::SeqCst);
                app2.exit(0);
            }
        });
    }
    false
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
    #[serde(default)]
    pub close_prompt_seen: Option<bool>,
}

#[tauri::command]
pub fn window_set_policy(
    app: AppHandle,
    args: WindowSetPolicyArgs,
) -> Result<WindowPolicyDto, String> {
    apply_policy(
        &app,
        args.close_action,
        args.tray_enabled,
        args.close_prompt_seen,
    );
    let p = app
        .state::<WindowPolicyState>()
        .0
        .lock()
        .map_err(|e| format!("policy lock: {e}"))?
        .clone();
    Ok(p.to_dto())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCloseDecisionArgs {
    /// "hide" | "quit"
    pub action: String,
    pub remember: bool,
}

/// FE response to `window://close-prompt`.
#[tauri::command]
pub fn window_close_decision(
    app: AppHandle,
    args: WindowCloseDecisionArgs,
) -> Result<(), String> {
    let action = normalize_close_action(Some(&args.action));
    // "ask" from dialog is not valid; treat as quit.
    let action = if action == "ask" {
        "quit".to_string()
    } else {
        action
    };

    if args.remember {
        let tray_enabled = action == "hide"
            || app
                .state::<WindowPolicyState>()
                .0
                .lock()
                .map(|p| p.tray_enabled)
                .unwrap_or(false)
            || action == "hide";
        let tray_on = if action == "hide" { true } else { tray_enabled };
        apply_policy(&app, action.clone(), tray_on, Some(true));
    }

    if action == "hide" {
        // One-shot hide: ensure tray for this session even if not remembered.
        if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
            p.tray_enabled = true;
            if args.remember {
                p.close_prompt_seen = true;
                p.close_action = "hide".into();
            }
        }
        perform_hide(&app);
    } else {
        // Quit path — ExitRequested may still prompt for active work.
        if args.remember {
            if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
                p.close_prompt_seen = true;
                p.close_action = "quit".into();
            }
        }
        app.exit(0);
    }
    Ok(())
}

#[tauri::command]
pub fn window_show_main(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn window_hide_main(app: AppHandle) -> Result<(), String> {
    perform_hide(&app);
    Ok(())
}

/// Request quit (same as chrome quit / tray quit). May prompt FE via ExitRequested.
#[tauri::command]
pub fn window_quit(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    app.exit(0);
    Ok(())
}

/// User confirmed quit (or no active work). Performs real exit + cleanup.
#[tauri::command]
pub fn window_force_quit(app: AppHandle) -> Result<(), String> {
    app.state::<QuitGuard>()
        .force
        .store(true, Ordering::SeqCst);
    app.state::<QuitGuard>()
        .exit_confirm_pending
        .store(false, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}

/// User cancelled exit-confirm (or chose hide instead).
#[tauri::command]
pub fn window_cancel_exit(app: AppHandle) -> Result<(), String> {
    app.state::<QuitGuard>()
        .exit_confirm_pending
        .store(false, Ordering::SeqCst);
    Ok(())
}

/// Hide instead of quitting from exit-confirm.
#[tauri::command]
pub fn window_exit_hide_instead(app: AppHandle) -> Result<(), String> {
    app.state::<QuitGuard>()
        .exit_confirm_pending
        .store(false, Ordering::SeqCst);
    if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
        p.tray_enabled = true;
    }
    perform_hide(&app);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySetStatusArgs {
    #[serde(default)]
    pub running_agents: u32,
    #[serde(default)]
    pub running_tasks: u32,
    #[serde(default)]
    pub label: Option<String>,
}

#[tauri::command]
pub fn window_is_main_visible(app: AppHandle) -> Result<bool, String> {
    Ok(app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false))
}

/// Sync OS login item with `launchAtLogin` preference.
#[tauri::command]
pub fn window_set_launch_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| e.to_string())?;
    } else {
        launcher.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_get_launch_at_login(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Hide main window at startup when launched with `--autostart` and policy allows.
pub fn maybe_start_hidden(app: &AppHandle) {
    let autostart_arg = std::env::args().any(|a| a == "--autostart");
    if !autostart_arg {
        return;
    }
    let policy = load_policy_from_disk(app);
    // Prefer explicit startHiddenOnLogin from disk; default true when autostart.
    let start_hidden = {
        let Some(path) = paths::hip_config_path(app) else {
            return;
        };
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return;
        };
        let Ok(toml_cfg) = toml::from_str::<TomlHipConfig>(&raw) else {
            return;
        };
        let hip: crate::hip_config::HipConfig = toml_cfg.into();
        hip.window
            .as_ref()
            .and_then(|w| w.start_hidden_on_login)
            .unwrap_or(true)
    };
    if !start_hidden {
        return;
    }
    // Ensure tray so the user can restore.
    if let Ok(mut p) = app.state::<WindowPolicyState>().0.lock() {
        p.tray_enabled = true;
        *p = WindowPolicy {
            close_action: policy.close_action,
            tray_enabled: true,
            tray_available: false,
            close_prompt_seen: policy.close_prompt_seen,
        };
    }
    sync_tray(app);
    hide_main_window(app);
    println!("[tauri] started hidden (--autostart)");
}

#[tauri::command]
pub fn tray_set_status(app: AppHandle, args: TraySetStatusArgs) -> Result<(), String> {
    let tooltip = if let Some(label) = args.label.filter(|s| !s.is_empty()) {
        label
    } else if args.running_agents > 0 || args.running_tasks > 0 {
        format!(
            "hip · {} agents · {} tasks",
            args.running_agents, args.running_tasks
        )
    } else {
        "hip".into()
    };

    if let Ok(slot) = app.state::<TrayState>().0.lock() {
        if let Some(tray) = slot.as_ref() {
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    } else if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(&tooltip));
    }
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
        assert!(!p.close_prompt_seen);
        assert!(!p.should_hide_on_close());
        assert!(p.needs_close_prompt()); // first close educates
    }

    #[test]
    fn hide_requires_tray_and_prompt_seen() {
        let mut p = policy_from_window_config(Some(&WindowConfig {
            close_action: Some("hide".into()),
            tray_enabled: Some(true),
            tray_always_visible: None,
            close_prompt_seen: Some(true),
            launch_at_login: None,
            start_hidden_on_login: None,
            notify_on_agent_complete: None,
            hide_hint_shown: None,
        }));
        assert!(!p.should_hide_on_close());
        p.tray_available = true;
        assert!(p.should_hide_on_close());
        assert!(!p.needs_close_prompt());
    }

    #[test]
    fn ask_always_needs_prompt() {
        let mut p = policy_from_window_config(Some(&WindowConfig {
            close_action: Some("ask".into()),
            tray_enabled: Some(true),
            tray_always_visible: None,
            close_prompt_seen: Some(true),
            launch_at_login: None,
            start_hidden_on_login: None,
            notify_on_agent_complete: None,
            hide_hint_shown: None,
        }));
        p.tray_available = true;
        assert!(p.needs_close_prompt());
        assert!(!p.should_hide_on_close());
    }

    #[test]
    fn unseen_prompt_blocks_hide() {
        let mut p = policy_from_window_config(Some(&WindowConfig {
            close_action: Some("hide".into()),
            tray_enabled: Some(true),
            tray_always_visible: None,
            close_prompt_seen: Some(false),
            launch_at_login: None,
            start_hidden_on_login: None,
            notify_on_agent_complete: None,
            hide_hint_shown: None,
        }));
        p.tray_available = true;
        assert!(p.needs_close_prompt());
        assert!(!p.should_hide_on_close());
    }

    #[test]
    fn normalize_unknown_to_quit() {
        assert_eq!(normalize_close_action(Some("minimize")), "quit");
        assert_eq!(normalize_close_action(Some("HIDE")), "hide");
    }
}
