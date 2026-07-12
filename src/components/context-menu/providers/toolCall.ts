import type { ContextMenuItemDef, ContextPayloadMap, ContextProvider } from '../types'

/**
 * Tool call row provider — copy input / output / error from protocol ToolCall.
 * Nested inside message / SubAgentCard; innermost DeclarativeContextMenu wins.
 */
export const toolCallProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'toolCall') return []
  const { tool } = req.payload as ContextPayloadMap['toolCall']
  const items: ContextMenuItemDef[] = []

  const hasInput = Boolean(tool.input)
  items.push({
    id: 'toolCall.copyInput',
    label: ctx.t('contextMenu.toolCall.copyInput'),
    group: 'clipboard',
    disabled: !hasInput,
    disabledReason: !hasInput ? ctx.t('contextMenu.toolCall.empty') : undefined,
    run: () => {
      if (!hasInput) return
      void ctx.copyText(tool.input)
    },
  })

  const hasOutput = tool.output != null && tool.output !== ''
  items.push({
    id: 'toolCall.copyOutput',
    label: ctx.t('contextMenu.toolCall.copyOutput'),
    group: 'clipboard',
    disabled: !hasOutput,
    disabledReason: !hasOutput ? ctx.t('contextMenu.toolCall.empty') : undefined,
    run: () => {
      if (!hasOutput || tool.output == null) return
      void ctx.copyText(tool.output)
    },
  })

  const hasError = tool.error != null && tool.error !== ''
  items.push({
    id: 'toolCall.copyError',
    label: ctx.t('contextMenu.toolCall.copyError'),
    group: 'clipboard',
    disabled: !hasError,
    disabledReason: !hasError ? ctx.t('contextMenu.toolCall.empty') : undefined,
    run: () => {
      if (!hasError || tool.error == null) return
      void ctx.copyText(tool.error)
    },
  })

  return items
}
