import { beforeEach, describe, expect, it } from 'vitest'
import { useFocusStore } from './focusStore'

describe('focusStore (P3 U10)', () => {
  beforeEach(() => {
    useFocusStore.setState({
      focusedCallId: null,
      focusedAgentId: null,
      focusedPath: null,
      followPaused: false,
      panelDismissedThisTurn: false,
      autoFollowEdits: true,
      deferredWriteFollow: null,
    })
  })

  it('user path selection pauses follow', () => {
    useFocusStore.getState().setFocusedPath('/a.ts', { userInitiated: true })
    expect(useFocusStore.getState().focusedPath).toBe('/a.ts')
    expect(useFocusStore.getState().followPaused).toBe(true)
  })

  it('agent follow path does not pause', () => {
    useFocusStore.getState().setFocusedPath('/b.ts')
    expect(useFocusStore.getState().followPaused).toBe(false)
  })

  it('resetFollowForTurn clears pause, dismiss, and deferred follow', () => {
    useFocusStore.getState().setFocusedPath('/a.ts', { userInitiated: true })
    useFocusStore.getState().dismissPanelThisTurn()
    useFocusStore.getState().setDeferredWriteFollow({
      sessionId: 's1',
      path: '/scripts/x.py',
      callId: 'c1',
    })
    useFocusStore.getState().resetFollowForTurn()
    expect(useFocusStore.getState().followPaused).toBe(false)
    expect(useFocusStore.getState().panelDismissedThisTurn).toBe(false)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
  })

  it('dismissPanelThisTurn sets flag and clears deferred follow', () => {
    useFocusStore.getState().setDeferredWriteFollow({
      sessionId: 's1',
      path: '/a.py',
      callId: 'c1',
    })
    useFocusStore.getState().dismissPanelThisTurn()
    expect(useFocusStore.getState().panelDismissedThisTurn).toBe(true)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
  })

  it('setDeferredWriteFollow / clearDeferredWriteFollow', () => {
    const d = { sessionId: 's1', path: '/a.py', callId: 'c1' }
    useFocusStore.getState().setDeferredWriteFollow(d)
    expect(useFocusStore.getState().deferredWriteFollow).toEqual(d)
    useFocusStore.getState().clearDeferredWriteFollow()
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
  })
})
