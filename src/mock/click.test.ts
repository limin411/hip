import { describe, it, expect } from 'vitest'
import { useUiStore } from '../store/uiStore'

describe('session click', () => {
  it('clicking each session should not throw', () => {
    const store = useUiStore.getState()
    const sessionIds = store.sessions.map((s) => s.id)

    for (const id of sessionIds) {
      store.selectSession(id)
      const state = useUiStore.getState()
      expect(state.activeSessionId).toBe(id)
      // simulate what ChatPane does
      const messages = state.messagesBySession[state.activeSessionId] ?? []
      expect(Array.isArray(messages)).toBe(true)
    }
  })

  it('click session then send message should not throw', () => {
    const store = useUiStore.getState()
    // Click on s2 (which has no messages initially)
    store.selectSession('s2')
    // Simulate send
    store.appendMessage('s2', { id: 'test1', role: 'user', content: 'hello' })
    store.appendMessage('s2', { id: 'test2', role: 'assistant', content: '' })
    store.appendToLastAssistant('s2', 'world')

    const state = useUiStore.getState()
    expect(state.messagesBySession['s2']).toHaveLength(2)
    expect(state.messagesBySession['s2']![1].content).toBe('world')
  })
})
