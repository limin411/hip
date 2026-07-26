import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Settings plugin row: optional view + uninstall (parity with card buttons). */
export const pluginProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'plugin') return []
  const { onUninstall, onView } = req.payload

  const items: ContextMenuItemDef[] = []

  if (onView) {
    items.push({
      id: 'plugin.view',
      label: ctx.t('settings.plugins.view'),
      group: 'primary',
      run: () => {
        onView()
      },
    })
  }

  items.push({
    id: 'plugin.uninstall',
    label: ctx.t('settings.plugins.uninstall'),
    group: 'danger',
    danger: true,
    run: () => {
      onUninstall()
    },
  })

  return items
}
