/**
 * Smoke: settings-list builtins are registered and catalog meta is present.
 * Surface wiring (DeclarativeContextMenu on cards) is covered in account/* tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildContextMenuItems, clearContextProviders } from '../registry'
import { listCatalogItems } from '../catalog'
import type { ContextMenuBuildContext } from '../types'

function makeCtx(): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'settings',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: [],
    copyText: vi.fn(async () => true),
  }
}

beforeEach(() => {
  clearContextProviders()
})

describe('settings list builtins + catalog', () => {
  it('catalog lists agent/skill/mcp/plugin meta', () => {
    expect(listCatalogItems('agentConfig').map((m) => m.id)).toEqual([
      'agentConfig.edit',
      'agentConfig.delete',
    ])
    expect(listCatalogItems('skillConfig').map((m) => m.id)).toEqual([
      'skillConfig.view',
      'skillConfig.delete',
    ])
    expect(listCatalogItems('mcpServer').map((m) => m.id)).toEqual([
      'mcpServer.edit',
      'mcpServer.delete',
    ])
    expect(listCatalogItems('plugin').map((m) => m.id)).toEqual(['plugin.uninstall'])
  })

  it('buildContextMenuItems resolves agent edit/delete via builtins', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const items = buildContextMenuItems(
      { kind: 'agentConfig', payload: { agentId: 'a1', onEdit, onDelete } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['agentConfig.edit', 'agentConfig.delete'])
    items.find((i) => i.id === 'agentConfig.edit')!.run()
    expect(onEdit).toHaveBeenCalled()
  })

  it('buildContextMenuItems resolves skill without delete when canDelete false', () => {
    const items = buildContextMenuItems(
      {
        kind: 'skillConfig',
        payload: {
          skillId: 's1',
          name: 'S',
          canDelete: false,
          onView: () => {},
          onDelete: () => {},
        },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['skillConfig.view'])
  })

  it('buildContextMenuItems resolves mcp + plugin', () => {
    const mcp = buildContextMenuItems(
      {
        kind: 'mcpServer',
        payload: { serverId: 'm1', onEdit: () => {}, onDelete: () => {} },
      },
      makeCtx(),
    )
    expect(mcp.map((i) => i.id)).toEqual(['mcpServer.edit', 'mcpServer.delete'])

    const plugin = buildContextMenuItems(
      { kind: 'plugin', payload: { pluginId: 'p1', onUninstall: () => {} } },
      makeCtx(),
    )
    expect(plugin.map((i) => i.id)).toEqual(['plugin.uninstall'])
  })
})
