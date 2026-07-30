/**
 * L1 host for History / Trash (and later Settings) overlay shells.
 * Mounted in AppLayout next to SessionMenuDialogHost.
 */
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { SessionHistory } from '@/components/history/SessionHistory'
import { RecycleBinPage } from '@/components/history/RecycleBinPage'
import { FLOOR, shellSize } from '@/lib/shellViewport'
import { useUiStore } from '@/store/uiStore'

export function OverlayShellHost() {
  const overlay = useUiStore((s) => s.overlay)
  const { t } = useTranslation()

  if (overlay !== 'history' && overlay !== 'trash') return null

  const onOpenChange = (open: boolean) => {
    if (!open) useUiStore.getState().setOverlay(null)
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
