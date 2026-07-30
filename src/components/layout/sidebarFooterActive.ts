import type { ActiveView, AppOverlay } from '@/store/uiStore'

/**
 * Hybrid footer active until special ActiveView values are removed (PR6).
 * Overlay wins when set; residual special activeView still highlights mid-migration.
 */
export function sidebarFooterActive(ui: {
  overlay: AppOverlay | null
  activeView: ActiveView
}): 'history' | 'trash' | 'settings' | null {
  if (ui.overlay === 'history' || ui.overlay === 'trash' || ui.overlay === 'settings') {
    return ui.overlay
  }
  if (
    ui.activeView === 'history' ||
    ui.activeView === 'trash' ||
    ui.activeView === 'settings'
  ) {
    return ui.activeView
  }
  return null
}
