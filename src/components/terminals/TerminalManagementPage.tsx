import { useCallback, useEffect } from 'react'
import { FolderOpen, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { pickDirectory } from '@/ipc/dialog'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { ManagedTerminalSession } from './ManagedTerminalSession'

/**
 * Terminal management main surface.
 * - focusedId null → empty / host-library placeholder (host library UI is PR4)
 * - focusedId set → single mounted ManagedTerminalSession (D6a exclusive XtermSurface)
 *
 * Keep-alive: leaving activeView terminals unmounts this page (and xterm) but does not
 * kill PTYs — managedTerminalStore + terminalStore rings persist for the process.
 */
export function TerminalManagementPage() {
  const { t } = useTranslation()
  const focusedId = useManagedTerminalStore((s) => s.focusedId)
  const terminals = useManagedTerminalStore((s) => s.terminals)

  // Ensure host catalog (recents) is warm for 快捷连接.
  useEffect(() => {
    if (!useTerminalHostStore.getState().loaded) {
      void useTerminalHostStore.getState().load()
    }
  }, [])

  const openLocalHome = useCallback(async () => {
    try {
      await useManagedTerminalStore.getState().openLocal()
    } catch (e) {
      console.error('[hip] open local terminal failed:', e)
    }
  }, [])

  const openLocalPick = useCallback(async () => {
    const dir = await pickDirectory()
    if (!dir) return
    try {
      await useManagedTerminalStore.getState().openLocal({ cwd: dir })
    } catch (e) {
      console.error('[hip] open local terminal failed:', e)
    }
  }, [])

  // Focused session mode — at most one XtermSurface (D6a).
  if (focusedId) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="terminal-management-page">
        <ManagedTerminalSession terminalId={focusedId} />
      </div>
    )
  }

  // Empty / library mode (no HostLibrary yet — PR4).
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6"
      data-testid="terminal-management-page"
    >
      <EmptyState
        icon={Terminal}
        title={
          terminals.length === 0
            ? t('terminals.emptyTitle')
            : t('terminals.selectOrNew')
        }
        description={
          terminals.length === 0
            ? t('terminals.emptyHint')
            : t('terminals.selectOrNewHint')
        }
        className="max-w-md"
      />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          data-testid="terminals-new-local"
          onClick={() => void openLocalHome()}
        >
          <Terminal size={14} className="mr-1.5" aria-hidden />
          {t('terminals.newLocal')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="terminals-new-local-folder"
          onClick={() => void openLocalPick()}
        >
          <FolderOpen size={14} className="mr-1.5" aria-hidden />
          {t('terminals.newLocalFolder')}
        </Button>
      </div>
    </div>
  )
}
