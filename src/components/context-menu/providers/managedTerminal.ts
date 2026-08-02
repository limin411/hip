import { openRenameManagedTerminalDialog } from '@/components/terminals/managedTerminalDialogStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { startTerminalAgentChat } from '@/components/terminals/terminalAgentSession'
import { deleteTerminalRecord } from '@/components/terminals/terminalRecordActions'
import { terminalSessionsFor } from '@/store/terminalAgentStore'
import { useDomainStore } from '@/domain/sessionStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * Sidebar / chrome menu for managed terminals (local + SSH).
 * Rename is process-ephemeral (display title only).
 * Close kills backend + clears ring; copy title uses clipboard helper.
 */
export const managedTerminalProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'managedTerminal') return []
  const { terminalId, kind, title } = req.payload
  if (!terminalId) return []

  const items: ContextMenuItemDef[] = [
    ...(kind === 'ssh'
      ? [
          {
            id: 'managedTerminal.newAgentChat',
            label: ctx.t('contextMenu.managedTerminal.newAgentChat'),
            group: 'primary' as const,
            run: () => {
              void startTerminalAgentChat(terminalId)
            },
          },
          {
            id: 'managedTerminal.reconnect',
            label: ctx.t('contextMenu.managedTerminal.reconnect'),
            group: 'navigation' as const,
            run: () => {
              void useManagedTerminalStore.getState().reconnect(terminalId)
            },
          },
        ]
      : []),
    {
      id: 'managedTerminal.rename',
      label: ctx.t('contextMenu.managedTerminal.rename'),
      group: 'edit',
      run: () => {
        // Prefer live store title (payload may be stale after a prior rename).
        const live =
          useManagedTerminalStore.getState().getTerminal(terminalId)?.title ?? title
        openRenameManagedTerminalDialog(terminalId, live || terminalId)
      },
    },
    {
      id: 'managedTerminal.copyTitle',
      label: ctx.t('contextMenu.managedTerminal.copyTitle'),
      group: 'clipboard',
      run: () => {
        const live =
          useManagedTerminalStore.getState().getTerminal(terminalId)?.title ?? title
        void ctx.copyText(live || terminalId)
      },
    },
    {
      id: 'managedTerminal.close',
      label: ctx.t('contextMenu.managedTerminal.close'),
      group: 'danger',
      danger: true,
      separatorBefore: true,
      run: () => {
        void useManagedTerminalStore.getState().close(terminalId)
      },
    },
    ...(kind === 'ssh'
      ? [
          {
            id: 'managedTerminal.deleteRecord',
            label: ctx.t('contextMenu.managedTerminal.deleteRecord'),
            group: 'danger' as const,
            danger: true,
            separatorBefore: true,
            run: () => {
              const live = useManagedTerminalStore.getState().getTerminal(terminalId)
              if (!live) return
              const count = terminalSessionsFor(
                useDomainStore.getState().sessions,
                terminalId,
              ).length
              const ok = window.confirm(
                `${ctx.t('contextMenu.managedTerminal.deleteRecordTitle', { label: live.title })} ` +
                  `${ctx.t('contextMenu.managedTerminal.deleteRecordBody')} ` +
                  `(${ctx.t('terminals.agent.sessionsGroup', { title: live.title })}: ${count})`,
              )
              if (ok) void deleteTerminalRecord(live)
            },
          },
        ]
      : []),
  ]

  return items
}
