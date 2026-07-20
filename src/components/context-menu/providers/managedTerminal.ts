import { openRenameManagedTerminalDialog } from '@/components/terminals/managedTerminalDialogStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * Sidebar / chrome menu for managed terminals (local + SSH).
 * Rename is process-ephemeral (display title only).
 * Close kills backend + clears ring; copy title uses clipboard helper.
 */
export const managedTerminalProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'managedTerminal') return []
  const { terminalId, title } = req.payload
  if (!terminalId) return []

  const items: ContextMenuItemDef[] = [
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
  ]

  return items
}
