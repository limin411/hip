import type { AppOverlay } from '@/store/uiStore'

/**
 * Footer utility highlight is overlay-only.
 * History / Trash remain modal shells; Settings uses the sidebar rail
 * (footer is replaced by SettingsSidebarContent while open).
 */
export function sidebarFooterActive(ui: {
  overlay: AppOverlay | null
}): AppOverlay | null {
  // Settings replaces the account footer with its own back control.
  if (ui.overlay === 'settings') return null
  return ui.overlay
}
