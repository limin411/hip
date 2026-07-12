import { sessionService } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import {
  openConfirmDeleteSessionsDialog,
  openRenameSessionDialog,
} from '@/components/history/sessionMenuDialogStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Path A: single close = closeSession (permanent delete) with no confirm; bulk = confirmed multi-delete. */
export const sessionTabProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'sessionTab') return []
  const { sessionId, title } = req.payload
  const openIds = ctx.openSessionIds
  const idx = openIds.indexOf(sessionId)
  const others = openIds.filter((id) => id !== sessionId)
  const toRight = idx >= 0 ? openIds.slice(idx + 1) : []

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
      run: () => {
        void ctx.copyText(sessionId)
      },
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
      // Match tab X label; domain still permanently deletes via closeSession.
      label: ctx.t('tabs.closeTab'),
      group: 'session',
      run: () => {
        sessionService.closeSession(sessionId)
      },
    },
    {
      id: 'sessionTab.deleteOthers',
      label: ctx.t('contextMenu.sessionTab.deleteOthers'),
      group: 'danger',
      danger: true,
      disabled: others.length === 0,
      run: () => {
        if (others.length === 0) return
        openConfirmDeleteSessionsDialog(others)
      },
    },
    {
      id: 'sessionTab.deleteToRight',
      label: ctx.t('contextMenu.sessionTab.deleteToRight'),
      group: 'danger',
      danger: true,
      disabled: toRight.length === 0,
      run: () => {
        if (toRight.length === 0) return
        openConfirmDeleteSessionsDialog(toRight)
      },
    },
    {
      id: 'sessionTab.deleteAllOpen',
      label: ctx.t('contextMenu.sessionTab.deleteAllOpen'),
      group: 'danger',
      danger: true,
      disabled: openIds.length === 0,
      run: () => {
        if (openIds.length === 0) return
        openConfirmDeleteSessionsDialog(openIds.slice())
      },
    },
  ]

  return items
}
