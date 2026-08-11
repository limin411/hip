import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Knowledge tree blank area: create doc/folder/table at root. */
export const knowledgeTreeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeTree') return []
  const { onNewDoc, onNewFolder, onNewTable } = req.payload

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
      id: 'knowledgeTree.newTable',
      label: ctx.t('knowledge.tree.newTable'),
      group: 'primary',
      run: () => {
        onNewTable()
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
