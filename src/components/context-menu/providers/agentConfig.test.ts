import { describe, it, expect, vi } from 'vitest'
import { agentConfigProvider } from './agentConfig'
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

describe('agentConfigProvider', () => {
  it('returns empty for other kinds', () => {
    expect(
      agentConfigProvider(
        { kind: 'plugin', payload: { pluginId: 'p1', onUninstall: () => {} } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits edit + delete (kebab parity)', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const items = agentConfigProvider(
      { kind: 'agentConfig', payload: { agentId: 'a1', onEdit, onDelete } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['agentConfig.edit', 'agentConfig.delete'])
    expect(items.find((i) => i.id === 'agentConfig.delete')?.danger).toBe(true)
    expect(items.find((i) => i.id === 'agentConfig.edit')?.label).toBe('settings.agents.edit')
    expect(items.find((i) => i.id === 'agentConfig.delete')?.label).toBe('settings.agents.delete')
  })

  it('run() invokes host handlers', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const items = agentConfigProvider(
      { kind: 'agentConfig', payload: { agentId: 'a1', onEdit, onDelete } },
      makeCtx(),
    )
    items.find((i) => i.id === 'agentConfig.edit')!.run()
    items.find((i) => i.id === 'agentConfig.delete')!.run()
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
