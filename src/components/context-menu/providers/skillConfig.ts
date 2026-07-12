import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Settings skill list: view + optional delete (kebab parity; no delete for plugin skills). */
export const skillConfigProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'skillConfig') return []
  const { canDelete, onView, onDelete } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'skillConfig.view',
      label: ctx.t('settings.skill.view'),
      group: 'primary',
      run: () => {
        onView()
      },
    },
  ]

  if (canDelete) {
    items.push({
      id: 'skillConfig.delete',
      label: ctx.t('settings.skill.delete'),
      group: 'danger',
      danger: true,
      run: () => {
        onDelete()
      },
    })
  }

  return items
}
