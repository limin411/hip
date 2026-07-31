import { useEffect } from 'react'
import { SETTINGS_SHELL_PAGE, useUiStore } from '@/store/uiStore'
import { SettingsPanel } from './SettingsPanel'

/**
 * Settings main-column body. Category nav is in AppSidebar (SettingsSidebarContent).
 * Esc: pop L2 editor first, then leave Settings.
 */
export function SettingsPage() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Let nested dialogs / menus consume Esc first.
      const t = e.target
      if (t instanceof HTMLElement) {
        if (t.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
      }
      const ui = useUiStore.getState()
      if (ui.overlay !== 'settings') return
      e.preventDefault()
      if (ui.settingsShellRoute.type !== 'page') {
        ui.setSettingsShellRoute(SETTINGS_SHELL_PAGE)
        return
      }
      ui.setOverlay(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-surface"
      data-testid="settings-page"
    >
      <SettingsPanel />
    </div>
  )
}
