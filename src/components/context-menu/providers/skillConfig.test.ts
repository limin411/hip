import { describe, it, expect, vi } from 'vitest'
import { skillConfigProvider } from './skillConfig'
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

describe('skillConfigProvider', () => {
  it('returns empty for other kinds', () => {
    expect(
      skillConfigProvider(
        { kind: 'plugin', payload: { pluginId: 'p1', onUninstall: () => {} } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits view + delete when canDelete', () => {
    const items = skillConfigProvider(
      {
        kind: 'skillConfig',
        payload: {
          skillId: 's1',
          name: 'Skill',
          canDelete: true,
          onView: () => {},
          onDelete: () => {},
        },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['skillConfig.view', 'skillConfig.delete'])
    expect(items.find((i) => i.id === 'skillConfig.delete')?.danger).toBe(true)
  })

  it('omits delete when canDelete is false (plugin skill)', () => {
    const onDelete = vi.fn()
    const items = skillConfigProvider(
      {
        kind: 'skillConfig',
        payload: {
          skillId: 's1',
          name: 'Skill',
          canDelete: false,
          onView: () => {},
          onDelete,
        },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['skillConfig.view'])
  })

  it('run() invokes host handlers', () => {
    const onView = vi.fn()
    const onDelete = vi.fn()
    const items = skillConfigProvider(
      {
        kind: 'skillConfig',
        payload: {
          skillId: 's1',
          name: 'Skill',
          canDelete: true,
          onView,
          onDelete,
        },
      },
      makeCtx(),
    )
    items.find((i) => i.id === 'skillConfig.view')!.run()
    items.find((i) => i.id === 'skillConfig.delete')!.run()
    expect(onView).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
