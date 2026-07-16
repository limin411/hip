import { toast } from 'sonner'
import { sessionService } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { openRenameSessionDialog } from '@/components/history/sessionMenuDialogStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Title-bar tab menu: rename / copy / reveal / close only. Permanent delete lives on History. */
export const sessionTabProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'sessionTab') return []
  const { sessionId, title } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'sessionTab.rename',
      label: ctx.t('contextMenu.sessionTab.rename'),
      group: 'edit',
      run: () => {
        openRenameSessionDialog(sessionId, title)
      },
    },
    {
      id: 'sessionTab.copyId',
      label: ctx.t('contextMenu.sessionTab.copyId'),
      group: 'clipboard',
      run: () =>
        ctx.copyText(sessionId).then((ok) => {
          if (!ok) toast.error(ctx.t('contextMenu.copyFailed'))
        }),
    },
    {
      id: 'sessionTab.revealInHistory',
      label: ctx.t('contextMenu.sessionTab.revealInHistory'),
      group: 'navigation',
      icon: 'history',
      run: () => {
        useUiStore.getState().setActiveView('history')
      },
    },
    {
      id: 'sessionTab.close',
      // Match tab X: soft-close only; permanent delete is History-only.
      label: ctx.t('tabs.closeTab'),
      group: 'session',
      run: () => {
        sessionService.closeSession(sessionId)
      },
    },
  ]

  return items
}
