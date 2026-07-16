import {
  openDeleteSessionDialog,
  openRenameSessionDialog,
} from '@/components/history/sessionMenuDialogStore'
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** History/sidebar row menu: open, rename (modal), permanent delete. No soft-close. */
export const sessionHistoryProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'sessionHistory') return []
  const { sessionId, title } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'sessionHistory.open',
      label: ctx.t('contextMenu.sessionHistory.open'),
      group: 'primary',
      run: () => {
        // Flush-safe open (leave knowledge if needed) — same path as sidebar click.
        void selectSessionFromSidebar(sessionId)
      },
    },
    {
      id: 'sessionHistory.rename',
      label: ctx.t('contextMenu.sessionHistory.rename'),
      group: 'edit',
      run: () => {
        openRenameSessionDialog(sessionId, title)
      },
    },
    {
      id: 'sessionHistory.delete',
      label: ctx.t('history.deleteSession'),
      group: 'danger',
      danger: true,
      run: () => {
        openDeleteSessionDialog(sessionId, title)
      },
    },
  ]

  return items
}
