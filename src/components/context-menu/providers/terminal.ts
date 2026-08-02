import { pickDirectory } from '@/ipc/dialog'
import { readText } from '@/ipc/clipboard'
import { requestTerminalRestart } from '@/components/artifact/terminalRestartUi'
import {
  getTerminalCanvasSelection,
  pasteToTerminalCanvas,
  terminalCanvasHasSelection,
} from '@/components/artifact/terminalCanvasUi'
import { setComposerQuote } from '@/components/command-palette/composerBridge'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useUiStore } from '@/store/uiStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { startTerminalAgentChat } from '@/components/terminals/terminalAgentSession'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/**
 * Terminal chrome (default) and xterm canvas (`target: 'canvas'`).
 * - Chrome: restart, change folder, copy cwd, open Files tab.
 * - Canvas: copy selection, paste, restart (via keyed bridges into XtermSurface).
 */
export const terminalProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'terminal') return []
  const { sessionId, target = 'chrome' } = req.payload
  if (!sessionId) return []

  if (target === 'canvas') {
    return canvasItems(sessionId, ctx)
  }
  return chromeItems(sessionId, ctx)
}

function canvasItems(
  sessionId: string,
  ctx: Parameters<ContextProvider>[1],
): ContextMenuItemDef[] {
  const hasSel = terminalCanvasHasSelection(sessionId)
  const isSshManaged = useManagedTerminalStore.getState().getTerminal(sessionId)?.kind === 'ssh'
  // Single group so mergeByGroup preserves copy → paste → restart (not primary-first).
  // Manual separatorBefore on restart stays meaningful within the group.
  return [
    {
      id: 'terminal.copySelection',
      label: ctx.t('contextMenu.terminal.copySelection'),
      group: 'clipboard',
      disabled: !hasSel,
      disabledReason: hasSel ? undefined : ctx.t('contextMenu.terminal.copySelectionDisabled'),
      run: () => {
        const text = getTerminalCanvasSelection(sessionId)
        if (!text) return
        void ctx.copyText(text)
      },
    },
    {
      id: 'terminal.sendSelectionToChat',
      label: ctx.t('contextMenu.terminal.sendSelectionToChat'),
      group: 'agent',
      disabled: !hasSel,
      disabledReason: hasSel ? undefined : ctx.t('contextMenu.terminal.copySelectionDisabled'),
      run: () => {
        const text = getTerminalCanvasSelection(sessionId)
        if (!text) return
        setComposerQuote(text)
      },
    },
    {
      id: 'terminal.explainInAgent',
      label: ctx.t('contextMenu.terminal.explainInAgent'),
      group: 'agent',
      disabled: !hasSel || !isSshManaged,
      disabledReason: hasSel
        ? isSshManaged
          ? undefined
          : ctx.t('contextMenu.terminal.explainInAgentDisabled')
        : ctx.t('contextMenu.terminal.copySelectionDisabled'),
      run: () => {
        const text = getTerminalCanvasSelection(sessionId)
        if (!text) return
        void startTerminalAgentChat(sessionId).then((agentSessionId) => {
          if (agentSessionId) {
            sessionService.sendMessageToSession(
              agentSessionId,
              `${ctx.t('terminals.agent.explainPrompt')}\n\n${text}`,
            )
          }
        })
      },
    },
    {
      id: 'terminal.paste',
      label: ctx.t('contextMenu.terminal.paste'),
      group: 'clipboard',
      run: async () => {
        const text = await readText()
        if (text == null || text === '') return
        pasteToTerminalCanvas(sessionId, text)
      },
    },
    {
      id: 'terminal.restart',
      label: ctx.t('contextMenu.terminal.restart'),
      group: 'clipboard',
      icon: 'history',
      separatorBefore: true,
      run: async () => {
        await requestTerminalRestart(sessionId)
      },
    },
  ]
}

function chromeItems(
  sessionId: string,
  ctx: Parameters<ContextProvider>[1],
): ContextMenuItemDef[] {
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
