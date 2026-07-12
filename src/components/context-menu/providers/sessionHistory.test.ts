import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sessionHistoryProvider } from './sessionHistory'
import type { ContextMenuBuildContext } from '../types'
import {
  getSessionMenuDialog,
  resetSessionMenuDialogStore,
} from '@/components/history/sessionMenuDialogStore'

const selectSession = vi.fn()

vi.mock('@/domain', () => ({
  sessionService: {
    selectSession: (...args: unknown[]) => selectSession(...args),
  },
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
    openSessionIds: [],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('sessionHistoryProvider', () => {
  beforeEach(() => {
    selectSession.mockClear()
    resetSessionMenuDialogStore()
  })

  afterEach(() => {
    resetSessionMenuDialogStore()
  })

  it('returns empty for other kinds', () => {
    expect(
      sessionHistoryProvider(
        { kind: 'sessionTab', payload: { sessionId: 's1', title: 'T', surface: 'chat' } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits open, rename, delete (no openTab)', () => {
    const items = sessionHistoryProvider(
      { kind: 'sessionHistory', payload: { sessionId: 's1', title: 'Alpha', surface: 'code' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'sessionHistory.open',
      'sessionHistory.rename',
      'sessionHistory.delete',
    ])
    expect(items.some((i) => i.id.includes('openTab'))).toBe(false)
  })

  it('open calls selectSession', () => {
    const items = sessionHistoryProvider(
      { kind: 'sessionHistory', payload: { sessionId: 's1', title: 'Alpha', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionHistory.open')!.run()
    expect(selectSession).toHaveBeenCalledWith('s1')
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
