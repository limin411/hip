import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Knowledge tree row: file actions only (rename, optional reveal, copy path,
 *  delete). New doc/table/folder entries live on the blank-area (knowledgeTree)
 *  and toolbar create menu — not on node context menus (Notion/Excel 语义). */
export const knowledgeNodeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeNode') return []
  const { kind, onRename, onDelete, onReveal, onCopyPath } = req.payload

  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'knowledgeNode.rename',
    label: ctx.t('knowledge.tree.rename'),
    group: 'edit',
    run: () => {
      onRename()
    },
  })

  if (onReveal && kind === 'doc') {
    items.push({
      id: 'knowledgeNode.reveal',
      label: ctx.t('knowledge.tree.reveal'),
      group: 'navigation',
      run: () => {
        onReveal()
      },
    })
  }

  if (onCopyPath) {
    items.push({
      id: 'knowledgeNode.copyPath',
      label: ctx.t('knowledge.tree.copyPath'),
      group: 'navigation',
      run: () => {
        onCopyPath()
      },
    })
  }

  items.push({
    id: 'knowledgeNode.delete',
    label: ctx.t('knowledge.tree.delete'),
    group: 'danger',
    danger: true,
    run: () => {
      onDelete()
    },
  })

  return items
}
