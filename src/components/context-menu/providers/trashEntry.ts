import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Recycle bin row: restore / copy title / permanent delete (host opens existing Modal). */
export const trashEntryProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'trashEntry') return []
  const { title, onRestore, onHardDelete } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'trashEntry.restore',
      label: ctx.t('trash.restore'),
      group: 'primary',
      run: () => {
        onRestore()
      },
    },
    {
      id: 'trashEntry.copyTitle',
      label: ctx.t('contextMenu.trashEntry.copyTitle'),
      group: 'clipboard',
      run: () => {
        void ctx.copyText(title)
      },
    },
    {
      id: 'trashEntry.hardDelete',
      label: ctx.t('trash.deleteForever'),
      group: 'danger',
      danger: true,
      run: () => {
        onHardDelete()
      },
    },
  ]
  return items
}
