import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sessionTabProvider } from './sessionTab'
import type { ContextMenuBuildContext } from '../types'
import {
  getSessionMenuDialog,
  resetSessionMenuDialogStore,
} from '@/components/history/sessionMenuDialogStore'

const closeSession = vi.fn()
const setActiveView = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}))

vi.mock('@/domain', () => ({
  sessionService: {
    closeSession: (...args: unknown[]) => closeSession(...args),
  },
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: {
    getState: () => ({
      setActiveView,
    }),
  },
}))

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: ['s1', 's2', 's3'],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('sessionTabProvider', () => {
  beforeEach(() => {
    closeSession.mockClear()
    setActiveView.mockClear()
    toastError.mockClear()
    resetSessionMenuDialogStore()
  })

  afterEach(() => {
    resetSessionMenuDialogStore()
  })

  it('returns empty for other kinds', () => {
    expect(
      sessionTabProvider(
        { kind: 'message', payload: { message: {} as never, isLastAssistant: false, sessionId: null } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits Path A items including honest bulk delete labels', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's2', title: 'Two', surface: 'chat' } },
      makeCtx(),
    )
    expect(items.map((i) => i.id)).toEqual([
      'sessionTab.rename',
      'sessionTab.copyId',
      'sessionTab.revealInHistory',
      'sessionTab.close',
      'sessionTab.deleteOthers',
      'sessionTab.deleteToRight',
      'sessionTab.deleteAllOpen',
    ])
    expect(items.find((i) => i.id === 'sessionTab.close')?.label).toBe('tabs.closeTab')
    expect(items.find((i) => i.id === 'sessionTab.deleteOthers')?.danger).toBe(true)
  })

  it('single close calls closeSession with no confirm dialog', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's2', title: 'Two', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionTab.close')!.run()
    expect(closeSession).toHaveBeenCalledWith('s2')
    expect(getSessionMenuDialog()).toBeNull()
  })

  it('deleteOthers opens confirm with other ids and does not close yet', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's2', title: 'Two', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionTab.deleteOthers')!.run()
    expect(closeSession).not.toHaveBeenCalled()
    expect(getSessionMenuDialog()).toEqual({
      kind: 'confirmBulkDelete',
      sessionIds: ['s1', 's3'],
    })
  })

  it('deleteToRight uses openSessionIds order after the target', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'One', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionTab.deleteToRight')!.run()
    expect(getSessionMenuDialog()).toEqual({
      kind: 'confirmBulkDelete',
      sessionIds: ['s2', 's3'],
    })
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('deleteAllOpen confirms all open ids without closing until accept', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'One', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionTab.deleteAllOpen')!.run()
    expect(closeSession).not.toHaveBeenCalled()
    expect(getSessionMenuDialog()).toEqual({
      kind: 'confirmBulkDelete',
      sessionIds: ['s1', 's2', 's3'],
    })
  })

  it('disables deleteOthers and deleteToRight when no targets', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'Only', surface: 'chat' } },
      makeCtx({ openSessionIds: ['s1'] }),
    )
    expect(items.find((i) => i.id === 'sessionTab.deleteOthers')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'sessionTab.deleteToRight')?.disabled).toBe(true)
    items.find((i) => i.id === 'sessionTab.deleteOthers')!.run()
    expect(getSessionMenuDialog()).toBeNull()
  })

  it('rename opens rename dialog without renaming immediately', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'Hello', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionTab.rename')!.run()
    expect(getSessionMenuDialog()).toEqual({
      kind: 'rename',
      sessionId: 's1',
      title: 'Hello',
    })
  })

  it('copyId copies session id', async () => {
    const copyText = vi.fn(async () => true)
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'Hello', surface: 'chat' } },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'sessionTab.copyId')!.run()
    expect(copyText).toHaveBeenCalledWith('s1')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('copyId toasts when clipboard copy fails', async () => {
    const copyText = vi.fn(async () => false)
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'Hello', surface: 'chat' } },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'sessionTab.copyId')!.run()
    expect(toastError).toHaveBeenCalledWith('contextMenu.copyFailed')
  })

  it('revealInHistory switches to history view', () => {
    const items = sessionTabProvider(
      { kind: 'sessionTab', payload: { sessionId: 's1', title: 'Hello', surface: 'chat' } },
      makeCtx(),
    )
    items.find((i) => i.id === 'sessionTab.revealInHistory')!.run()
    expect(setActiveView).toHaveBeenCalledWith('history')
  })
})
