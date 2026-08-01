/**
 * Right-rail open sizing: before expanding the right panel, widen the app window
 * so the main content area (window width minus the left sidebar) reaches a
 * minimum width — unless the display is too small to host it.
 */

/** Minimum main-content width (px) required before opening the right rail. */
export const RIGHT_PANEL_MAIN_TARGET = 1600
/** Screens narrower than this cannot host the target; fall back to original behavior. */
export const RIGHT_PANEL_SCREEN_MIN = 1600

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Main content area width = window width minus the left sidebar (when open). */
export function mainContentWidth(sidebarOpen: boolean, sidebarWidth: number): number {
  // Prefer the live DOM measure (PanelGroup host) when present.
  const el = document.querySelector<HTMLElement>('[data-main-content-group]')
  if (el && el.clientWidth > 0) return el.clientWidth
  return Math.round(window.innerWidth - (sidebarOpen ? sidebarWidth : 0))
}

/**
 * Widen the window so the main content area reaches RIGHT_PANEL_MAIN_TARGET
 * before the right panel opens. Returns true when a resize was issued; false
 * (caller falls back to the original open flow) when already wide enough, the
 * screen resolution is insufficient, or the resize failed.
 */
export async function widenWindowForRightPanel(sidebarOpen: boolean, sidebarWidth: number): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!isTauriRuntime()) return false

  const current = mainContentWidth(sidebarOpen, sidebarWidth)
  if (current >= RIGHT_PANEL_MAIN_TARGET) return false

  const avail = window.screen?.availWidth ?? 0
  if (avail < RIGHT_PANEL_SCREEN_MIN) return false

  // Target window inner width so that (window − sidebar) ≈ MAIN_TARGET.
  // Clamp to the screen so we never push the frame off-display.
  const sidebarPx = sidebarOpen ? sidebarWidth : 0
  const desiredWindow = RIGHT_PANEL_MAIN_TARGET + sidebarPx
  // Grow from the current window so we only enlarge (never shrink).
  const targetWidth = Math.max(
    window.innerWidth,
    Math.min(desiredWindow, avail),
  )
  if (targetWidth <= window.innerWidth + 1) return false

  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    // Prefer CSS logical height — same coordinate space as window.innerWidth.
    const height = Math.max(1, Math.round(window.innerHeight))
    await win.setSize(new LogicalSize(Math.round(targetWidth), height))
    return true
  } catch (err) {
    console.warn('[hip] widenWindowForRightPanel failed:', err)
    return false
  }
}
