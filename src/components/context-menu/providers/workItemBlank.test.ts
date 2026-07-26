import { describe, it, expect, vi } from 'vitest'
import { workItemBlankProvider } from './workItemBlank'
import type { ContextMenuBuildContext } from '../types'

const requestCreate = vi.fn()

vi.mock('@/store/workItemViewStore', () => ({
  useWorkItemViewStore: {
    getState: () => ({ requestCreate }),
  },
}))

function makeCtx(): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'tasks',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
  }
}

describe('workItemBlankProvider', () => {
  it('creates with provided dates', () => {
    requestCreate.mockClear()
    const items = workItemBlankProvider(
      { kind: 'workItemBlank', payload: { startOn: '2026-07-01', endOn: '2026-07-01' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual(['workItemBlank.create'])
    items[0]!.run()
    expect(requestCreate).toHaveBeenCalledWith({
      startOn: '2026-07-01',
      endOn: '2026-07-01',
    })
  })
})
