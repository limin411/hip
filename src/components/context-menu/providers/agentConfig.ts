import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Settings agent list: edit + delete (kebab parity). */
export const agentConfigProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'agentConfig') return []
  const { onEdit, onDelete } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'agentConfig.edit',
      label: ctx.t('settings.agents.edit'),
      group: 'edit',
      run: () => {
        onEdit()
      },
    },
    {
      id: 'agentConfig.delete',
      label: ctx.t('settings.agents.delete'),
      group: 'danger',
      danger: true,
      run: () => {
        onDelete()
      },
    },
  ]

  return items
}
