import type { ContextMenuItemDef, ContextProvider, ContextRequest } from '../types'

function isCodeBlockRequest(req: ContextRequest): req is ContextRequest<'codeBlock'> {
  return req.kind === 'codeBlock'
}

export const codeBlockProvider: ContextProvider = (req, ctx) => {
  if (!isCodeBlockRequest(req)) return []

  const { code } = req.payload
  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'codeBlock.copy',
    label: ctx.t('contextMenu.codeBlock.copy'),
    group: 'clipboard',
    run: () => {
      if (code) void ctx.copyText(code)
    },
  })

  return items
}
