import {
  openDeleteKnowledgeSpaceDialog,
  openRenameKnowledgeSpaceDialog,
} from '@/components/knowledge/knowledgeSpaceDialogStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Sidebar knowledge-space row: rename + delete. */
export const knowledgeSpaceProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeSpace') return []
  const { spaceId, name, icon } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'knowledgeSpace.rename',
      label: ctx.t('knowledge.tree.rename'),
      group: 'edit',
      run: () => {
        openRenameKnowledgeSpaceDialog(spaceId, name, icon)
      },
    },
    {
      id: 'knowledgeSpace.delete',
      label: ctx.t('knowledge.tree.delete'),
      group: 'danger',
      danger: true,
      run: () => {
        openDeleteKnowledgeSpaceDialog(spaceId, name)
      },
    },
  ]

  return items
}
