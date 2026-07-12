import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Settings MCP server row: edit + delete (parity with card action buttons). */
export const mcpServerProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'mcpServer') return []
  const { onEdit, onDelete } = req.payload

  const items: ContextMenuItemDef[] = [
    {
      id: 'mcpServer.edit',
      label: ctx.t('settings.mcp.edit'),
      group: 'edit',
      run: () => {
        onEdit()
      },
    },
    {
      id: 'mcpServer.delete',
      label: ctx.t('settings.mcp.delete'),
      group: 'danger',
      danger: true,
      run: () => {
        onDelete()
      },
    },
  ]

  return items
}
