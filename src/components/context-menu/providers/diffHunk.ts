import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Diff hunk: copy unified hunk text. */
export const diffHunkProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'diffHunk') return []
  const { text } = req.payload
  if (!text) return []

  const items: ContextMenuItemDef[] = [
    {
      id: 'diffHunk.copy',
      label: ctx.t('contextMenu.diffHunk.copy'),
      group: 'clipboard',
      icon: 'code',
      run: () => {
        void ctx.copyText(text)
      },
    },
  ]
  return items
}
