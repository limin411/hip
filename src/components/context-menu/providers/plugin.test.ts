import { describe, it, expect, vi } from 'vitest'
import { pluginProvider } from './plugin'
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

describe('pluginProvider', () => {
  it('returns empty for other kinds', () => {
    expect(
      pluginProvider(
        {
          kind: 'agentConfig',
          payload: { agentId: 'a1', onEdit: () => {}, onDelete: () => {} },
        },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits uninstall only when onView is absent', () => {
    const items = pluginProvider(
      { kind: 'plugin', payload: { pluginId: 'p1', onUninstall: () => {} } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['plugin.uninstall'])
    expect(items[0]?.danger).toBe(true)
    expect(items[0]?.label).toBe('settings.plugins.uninstall')
  })

  it('emits view + uninstall when onView is present', () => {
    const items = pluginProvider(
      {
        kind: 'plugin',
        payload: { pluginId: 'p1', onUninstall: () => {}, onView: () => {} },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['plugin.view', 'plugin.uninstall'])
    expect(items[0]?.group).toBe('primary')
    expect(items[0]?.label).toBe('settings.plugins.view')
    expect(items[1]?.danger).toBe(true)
  })

  it('run() invokes host handlers', () => {
    const onUninstall = vi.fn()
    const onView = vi.fn()
    const items = pluginProvider(
      { kind: 'plugin', payload: { pluginId: 'p1', onUninstall, onView } },
      makeCtx(),
    )
    items.find((i) => i.id === 'plugin.view')!.run()
    items.find((i) => i.id === 'plugin.uninstall')!.run()
    expect(onView).toHaveBeenCalledTimes(1)
    expect(onUninstall).toHaveBeenCalledTimes(1)
  })
})
