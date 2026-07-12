import { pickDirectory } from '@/ipc/dialog'
import { requestTerminalRestart } from '@/components/artifact/terminalRestartUi'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useUiStore } from '@/store/uiStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * TerminalView chrome only (not xterm canvas — PR-9).
 * Restart PTY, change folder, copy cwd, open Files tab.
 * Restart reuses TerminalView's existing restart handler via terminalRestartUi bridge.
 */
export const terminalProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'terminal') return []
  const { sessionId } = req.payload
  if (!sessionId) return []

  const domainSession = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
  const cwd = domainSession?.config.cwd?.trim() || undefined

  const items: ContextMenuItemDef[] = [
    {
      id: 'terminal.restart',
      label: ctx.t('contextMenu.terminal.restart'),
      group: 'primary',
      icon: 'history',
      run: async () => {
        await requestTerminalRestart(sessionId)
      },
    },
    {
      id: 'terminal.changeFolder',
      label: ctx.t('contextMenu.terminal.changeFolder'),
      group: 'workspace',
      run: async () => {
        const dir = await pickDirectory()
        if (!dir) return
        sessionService.setProjectDir(sessionId, dir)
      },
    },
  ]

  if (cwd) {
    items.push({
      id: 'terminal.copyCwd',
      label: ctx.t('contextMenu.terminal.copyCwd'),
      group: 'clipboard',
      run: () => {
        void ctx.copyText(cwd)
      },
    })
  }

  items.push({
    id: 'terminal.openFiles',
    label: ctx.t('contextMenu.terminal.openFiles'),
    group: 'navigation',
    icon: 'code',
    run: () => {
      useUiStore.getState().setTab('files')
    },
  })

  return items
}
