import type { AppOverlay } from '@/store/uiStore'

/**
 * Footer utility highlight is overlay-only (History / Trash / Settings are shells).
 */
export function sidebarFooterActive(ui: {
  overlay: AppOverlay | null
}): AppOverlay | null {
  return ui.overlay
}
