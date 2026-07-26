import { describe, it, expect, vi } from 'vitest'
import { trashEntryProvider } from './trashEntry'
import type { ContextMenuBuildContext } from '../types'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'trash',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('trashEntryProvider', () => {
  it('emits restore, copyTitle, hardDelete', () => {
    const onRestore = vi.fn()
    const onHardDelete = vi.fn()
    const items = trashEntryProvider(
      {
        kind: 'trashEntry',
        payload: {
          key: 'session:s1',
          source: 'session',
          id: 's1',
          title: 'Old chat',
          onRestore,
          onHardDelete,
        },
      },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'trashEntry.restore',
      'trashEntry.copyTitle',
      'trashEntry.hardDelete',
    ])
    expect(items.find((i) => i.id === 'trashEntry.hardDelete')?.danger).toBe(true)
    items.find((i) => i.id === 'trashEntry.restore')!.run()
    items.find((i) => i.id === 'trashEntry.hardDelete')!.run()
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onHardDelete).toHaveBeenCalledTimes(1)
  })
})
