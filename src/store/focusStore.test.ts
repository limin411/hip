import { beforeEach, describe, expect, it } from 'vitest'
import { useFocusStore } from './focusStore'

describe('focusStore (P3 U10)', () => {
  beforeEach(() => {
    useFocusStore.setState({
      focusedCallId: null,
      focusedAgentId: null,
      focusedPath: null,
      followPaused: false,
      autoFollowEdits: true,
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

  it('resetFollowForTurn clears pause', () => {
    useFocusStore.getState().setFocusedPath('/a.ts', { userInitiated: true })
    useFocusStore.getState().resetFollowForTurn()
    expect(useFocusStore.getState().followPaused).toBe(false)
  })
})
