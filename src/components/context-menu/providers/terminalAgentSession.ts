import { sessionService } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { openRenameSessionDialog } from '@/components/history/sessionMenuDialogStore'
import { terminalSessionsFor, useTerminalAgentStore } from '@/store/terminalAgentStore'
import type { ContextProvider } from '../types'

/** Sidebar child rows under an SSH managed terminal (D7): open / rename / delete. */
export const terminalAgentSessionProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'terminalAgentSession') return []
  const { sessionId, terminalId, title } = req.payload
  if (!sessionId || !terminalId) return []

  return [
    {
      id: 'terminalAgentSession.open',
      label: ctx.t('contextMenu.terminalAgentSession.open'),
      group: 'primary',
      run: () => sessionService.focusTerminalAgentSession(terminalId, sessionId),
    },
    {
      id: 'terminalAgentSession.rename',
      label: ctx.t('contextMenu.terminalAgentSession.rename'),
      group: 'edit',
      run: () => openRenameSessionDialog(sessionId, title),
    },
    {
      id: 'terminalAgentSession.delete',
      label: ctx.t('contextMenu.terminalAgentSession.delete'),
      group: 'danger',
      danger: true,
      separatorBefore: true,
      run: () => {
        const ok = window.confirm(
          `${ctx.t('terminals.agent.deleteTitle')} ${ctx.t('terminals.agent.deleteBody')}`,
        )
        if (!ok) return
        sessionService.trashSession(sessionId, { reason: 'terminal-agent-session-delete' })
        // Active fallback: nearest sibling, else empty state (spec §3.5.6).
        const remaining = terminalSessionsFor(useDomainStore.getState().sessions, terminalId).filter(
          (s) => s.id !== sessionId,
        )
        const next = remaining[0]?.id ?? null
        useTerminalAgentStore.getState().setActiveSession(terminalId, next)
      },
    },
  ]
}
