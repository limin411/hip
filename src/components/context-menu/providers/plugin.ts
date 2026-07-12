import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Settings plugin row: uninstall (parity with card uninstall button). */
export const pluginProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'plugin') return []
  const { onUninstall } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'plugin.uninstall',
      label: ctx.t('settings.plugins.uninstall'),
      group: 'danger',
      danger: true,
      run: () => {
        onUninstall()
      },
    },
  ]

  return items
}
