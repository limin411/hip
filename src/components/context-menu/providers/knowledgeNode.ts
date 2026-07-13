import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Knowledge tree row: new doc/folder (folder or parent of doc), rename, delete. */
export const knowledgeNodeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeNode') return []
  const { kind, onNewDoc, onNewFolder, onRename, onDelete, onReveal } = req.payload

  const items: ContextMenuItemDef[] = []

  if (kind === 'folder') {
    items.push(
      {
        id: 'knowledgeNode.newDoc',
        label: ctx.t('knowledge.tree.newDoc'),
        group: 'primary',
        run: () => {
          onNewDoc()
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
    )
  } else {
    // Doc: create siblings under same parent (handlers bound by host)
    items.push(
      {
        id: 'knowledgeNode.newDoc',
        label: ctx.t('knowledge.tree.newDoc'),
        group: 'primary',
        run: () => {
          onNewDoc()
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
    )
  }

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
