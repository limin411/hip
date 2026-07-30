import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Knowledge tree row: new doc/whiteboard/folder, rename, optional reveal, delete. */
export const knowledgeNodeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeNode') return []
  const { kind, onNewDoc, onNewBoard, onNewFolder, onRename, onDelete, onReveal } =
    req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'knowledgeNode.newDoc',
      label: ctx.t('knowledge.tree.newDoc'),
      group: 'primary',
      run: () => {
        onNewDoc()
      },
    },
    {
      id: 'knowledgeNode.newBoard',
      label: ctx.t('knowledge.tree.newBoard'),
      group: 'primary',
      run: () => {
        onNewBoard()
      },
    },
    {
      id: 'knowledgeNode.newFolder',
      label: ctx.t('knowledge.tree.newFolder'),
      group: 'primary',
      run: () => {
        onNewFolder()
      },
    },
    {
      id: 'knowledgeNode.rename',
      label: ctx.t('knowledge.tree.rename'),
      group: 'edit',
      run: () => {
        onRename()
      },
    },
  ]

  if (onReveal && (kind === 'doc' || kind === 'board')) {
    items.push({
      id: 'knowledgeNode.reveal',
      label: ctx.t('knowledge.tree.reveal'),
      group: 'navigation',
      run: () => {
        onReveal()
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
