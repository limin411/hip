import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * Sidebar / chrome menu for managed terminals (local + future SSH).
 * Close kills backend + clears ring; copy title uses clipboard helper.
 */
export const managedTerminalProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'managedTerminal') return []
  const { terminalId, title } = req.payload
  if (!terminalId) return []

  const items: ContextMenuItemDef[] = [
    {
      id: 'managedTerminal.copyTitle',
      label: ctx.t('contextMenu.managedTerminal.copyTitle'),
      group: 'clipboard',
      run: () => {
        void ctx.copyText(title || terminalId)
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
