import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Knowledge tree row: folder gets new doc/table/folder; files (doc/table) get
 *  file actions only (rename, optional reveal, copy path, delete). */
export const knowledgeNodeProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeNode') return []
  const { kind, onNewDoc, onNewFolder, onNewTable, onRename, onDelete, onReveal, onCopyPath } =
    req.payload

  const items: ContextMenuItemDef[] = []

  // 新建入口仅属于文件夹（在文件夹内新建）；右键文件只出现文件操作，
  // 与 Notion/Excel 一致——避免在文件菜单里混入不相关的新建动作。
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
        id: 'knowledgeNode.newTable',
        label: ctx.t('knowledge.tree.newTable'),
        group: 'primary',
        run: () => {
          onNewTable()
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
