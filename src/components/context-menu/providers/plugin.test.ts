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
    openSessionIds: [],
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

  it('emits uninstall (danger)', () => {
    const items = pluginProvider(
      { kind: 'plugin', payload: { pluginId: 'p1', onUninstall: () => {} } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['plugin.uninstall'])
    expect(items[0]?.danger).toBe(true)
    expect(items[0]?.label).toBe('settings.plugins.uninstall')
  })

  it('run() invokes host onUninstall', () => {
    const onUninstall = vi.fn()
    const items = pluginProvider(
      { kind: 'plugin', payload: { pluginId: 'p1', onUninstall } },
      makeCtx(),
    )
    items[0]!.run()
    expect(onUninstall).toHaveBeenCalledTimes(1)
  })
})
