/**
 * L1 host for History / Trash / Settings overlay shells.
 * Mounted in AppLayout next to SessionMenuDialogHost.
 */
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { SessionHistory } from '@/components/history/SessionHistory'
import { RecycleBinPage } from '@/components/history/RecycleBinPage'
import { SettingsPage } from '@/components/account/SettingsPage'
import { FLOOR, shellSize } from '@/lib/shellViewport'
import { SETTINGS_SHELL_PAGE, useUiStore } from '@/store/uiStore'

export function OverlayShellHost() {
  const overlay = useUiStore((s) => s.overlay)
  const { t } = useTranslation()

  if (overlay !== 'history' && overlay !== 'trash' && overlay !== 'settings') {
    return null
  }

  const onOpenChange = (open: boolean) => {
    if (!open) useUiStore.getState().setOverlay(null)
  }

  /** Esc: pop Settings L2 route before closing the shell. */
  const onSettingsEscape = (): boolean => {
    const ui = useUiStore.getState()
    if (ui.settingsShellRoute.type !== 'page') {
      ui.setSettingsShellRoute(SETTINGS_SHELL_PAGE)
      return true
    }
    return false
  }

  const w = typeof window !== 'undefined' ? window.innerWidth : 1800
  const h = typeof window !== 'undefined' ? window.innerHeight : 1100
  const kind = overlay
  const defaultSize = shellSize(w, h, kind)
  const minSize = {
    width: Math.min(FLOOR.width, defaultSize.width),
    height: Math.min(FLOOR.height, defaultSize.height),
  }

  if (overlay === 'history') {
    return (
      <Modal
        variant="shell"
        open
        onOpenChange={onOpenChange}
        title={t('history.title')}
        resizable
        defaultSize={defaultSize}
        minSize={minSize}
        storageKey="overlay-shell-history"
      >
        <div
          data-testid="overlay-shell-history"
          className="flex min-h-0 flex-1 flex-col"
        >
          <SessionHistory embeddedInShell />
        </div>
      </Modal>
    )
  }

  if (overlay === 'trash') {
    return (
      <Modal
        variant="shell"
        open
        onOpenChange={onOpenChange}
        title={t('trash.title')}
        resizable
        defaultSize={defaultSize}
        minSize={minSize}
        storageKey="overlay-shell-trash"
      >
        <div
          data-testid="overlay-shell-trash"
          className="flex min-h-0 flex-1 flex-col"
        >
          <RecycleBinPage embeddedInShell />
        </div>
      </Modal>
    )
  }

  // settings — scrim dismiss allowed (onOpenChange false)
  return (
    <Modal
      variant="shell"
      open
      onOpenChange={onOpenChange}
      title={t('settings.title')}
      resizable
      defaultSize={defaultSize}
      minSize={minSize}
      storageKey="overlay-shell-settings"
      onEscapeKeyDown={onSettingsEscape}
    >
      <div
        data-testid="overlay-shell-settings"
        className="flex min-h-0 flex-1 flex-col"
      >
        <SettingsPage />
      </div>
    </Modal>
  )
}
