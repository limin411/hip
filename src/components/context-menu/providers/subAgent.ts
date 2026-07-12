import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

/**
 * Sub-agent card provider — copy agent id / task input / output from TurnAgent.
 * Nested ToolCallRow menus take precedence (innermost wins).
 */
export const subAgentProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'subAgent') return []
  const { agent } = req.payload as ContextPayloadMap['subAgent']
  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'subAgent.copyId',
    label: ctx.t('contextMenu.subAgent.copyId'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(agent.agentId)
    },
  })

  const task = agent.taskInput ?? ''
  const hasTask = task !== ''
  items.push({
    id: 'subAgent.copyTask',
    label: ctx.t('contextMenu.subAgent.copyTask'),
    group: 'clipboard',
    disabled: !hasTask,
    disabledReason: !hasTask ? ctx.t('contextMenu.subAgent.empty') : undefined,
    run: () => {
      if (!hasTask) return
      void ctx.copyText(task)
    },
  })

  const hasOutput = Boolean(agent.output)
  items.push({
    id: 'subAgent.copyOutput',
    label: ctx.t('contextMenu.subAgent.copyOutput'),
    group: 'clipboard',
    disabled: !hasOutput,
    disabledReason: !hasOutput ? ctx.t('contextMenu.subAgent.empty') : undefined,
    run: () => {
      if (!hasOutput) return
      void ctx.copyText(agent.output)
    },
  })

  return items
}
