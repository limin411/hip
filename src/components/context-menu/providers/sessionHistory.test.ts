import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sessionHistoryProvider } from './sessionHistory'
import type { ContextMenuBuildContext } from '../types'
import {
  getSessionMenuDialog,
  resetSessionMenuDialogStore,
} from '@/components/history/sessionMenuDialogStore'

const selectSessionFromSidebar = vi.fn(async (_id: string) => {})

vi.mock('@/components/layout/sidebarActions', () => ({
  selectSessionFromSidebar: (id: string) => selectSessionFromSidebar(id),
}))

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'history',
    surface: null,
    activeSessionId: null,
    sessionStatus: 'idle',
    sessionInterrupt: false,
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('sessionHistoryProvider', () => {
  beforeEach(() => {
    selectSessionFromSidebar.mockClear()
    resetSessionMenuDialogStore()
  })

  afterEach(() => {
    resetSessionMenuDialogStore()
  })

  it('returns empty for other kinds', () => {
    expect(
      sessionHistoryProvider(
        { kind: 'codeBlock', payload: { code: 'x' } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits open, rename, delete (no soft-close)', () => {
    const items = sessionHistoryProvider(
      { kind: 'sessionHistory', payload: { sessionId: 's1', title: 'Alpha', surface: 'code' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'sessionHistory.open',
      'sessionHistory.rename',
      'sessionHistory.delete',
    ])
    expect(items.some((i) => i.id.includes('close') || i.id.includes('openTab'))).toBe(false)
  })

  it('open calls selectSessionFromSidebar (flush-safe)', () => {
    const items = sessionHistoryProvider(
      { kind: 'sessionHistory', payload: { sessionId: 's1', title: 'Alpha', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionHistory.open')!.run()
    expect(selectSessionFromSidebar).toHaveBeenCalledWith('s1')
  })

  it('rename opens RenameSessionDialog via store', () => {
    const items = sessionHistoryProvider(
      { kind: 'sessionHistory', payload: { sessionId: 's1', title: 'Alpha', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionHistory.rename')!.run()
    expect(getSessionMenuDialog()).toEqual({
      kind: 'rename',
      sessionId: 's1',
      title: 'Alpha',
    })
  })

  it('delete opens DeleteSessionDialog via store (does not delete immediately)', () => {
    const items = sessionHistoryProvider(
      { kind: 'sessionHistory', payload: { sessionId: 's1', title: 'Alpha', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionHistory.delete')!.run()
    expect(getSessionMenuDialog()).toEqual({
      kind: 'deleteSession',
      sessionId: 's1',
      title: 'Alpha',
    })
  })
})
