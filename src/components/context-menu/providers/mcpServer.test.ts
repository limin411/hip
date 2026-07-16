import { describe, it, expect, vi } from 'vitest'
import { mcpServerProvider } from './mcpServer'
import type { ContextMenuBuildContext } from '../types'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'settings',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('mcpServerProvider', () => {
  it('returns empty for other kinds', () => {
    expect(
      mcpServerProvider(
        { kind: 'plugin', payload: { pluginId: 'p1', onUninstall: () => {} } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits edit + delete', () => {
    const items = mcpServerProvider(
      {
        kind: 'mcpServer',
        payload: { serverId: 'm1', onEdit: () => {}, onDelete: () => {} },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['mcpServer.edit', 'mcpServer.delete'])
    expect(items.find((i) => i.id === 'mcpServer.delete')?.danger).toBe(true)
    expect(items.find((i) => i.id === 'mcpServer.edit')?.label).toBe('settings.mcp.edit')
  })

  it('run() invokes host handlers', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const items = mcpServerProvider(
      { kind: 'mcpServer', payload: { serverId: 'm1', onEdit, onDelete } },
      makeCtx(),
    )
    items.find((i) => i.id === 'mcpServer.edit')!.run()
    items.find((i) => i.id === 'mcpServer.delete')!.run()
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
