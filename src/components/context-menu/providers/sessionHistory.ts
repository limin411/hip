import { sessionService } from '@/domain'
import {
  openDeleteSessionDialog,
  openRenameSessionDialog,
} from '@/components/history/sessionMenuDialogStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** History row menu: open, rename (modal), delete (DeleteSessionDialog). No background openTab. */
export const sessionHistoryProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'sessionHistory') return []
  const { sessionId, title } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'sessionHistory.open',
      label: ctx.t('contextMenu.sessionHistory.open'),
      group: 'primary',
      run: () => {
        sessionService.selectSession(sessionId)
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
