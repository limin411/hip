import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Knowledge tree blank area: create doc/whiteboard/folder at root. */
export const knowledgeTreeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeTree') return []
  const { onNewDoc, onNewBoard, onNewFolder } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'knowledgeTree.newDoc',
      label: ctx.t('knowledge.tree.newDoc'),
      group: 'primary',
      run: () => {
        onNewDoc()
      },
    },
    {
      id: 'knowledgeTree.newBoard',
      label: ctx.t('knowledge.tree.newBoard'),
      group: 'primary',
      run: () => {
        onNewBoard()
      },
    },
    {
      id: 'knowledgeTree.newFolder',
      label: ctx.t('knowledge.tree.newFolder'),
      group: 'primary',
      run: () => {
        onNewFolder()
      },
    },
  ]

  return items
}
