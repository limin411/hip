import { describe, it, expect, beforeEach } from 'vitest'
import { useDomainStore } from '../domain/sessionStore'

function reset() {
  useDomainStore.setState({
    sessions: [
      { id: 's1', config: { llmProvider: 'anthropic', model: 'm', tools: [] }, title: 'S1', preview: 'P1', updatedAt: 'now', messages: [], agents: [], status: 'idle' },
      { id: 's2', config: { llmProvider: 'anthropic', model: 'm', tools: [] }, title: 'S2', preview: 'P2', updatedAt: 'now', messages: [], agents: [], status: 'idle' },
    ],
    activeSessionId: 's1',
    connection: 'disconnected',
  })
}

describe('session click', () => {
  beforeEach(() => reset())

  it('clicking each session should not throw', () => {
    const sessionIds = useDomainStore.getState().sessions.map((s) => s.id)

    for (const id of sessionIds) {
      useDomainStore.getState().selectSession(id)
      const state = useDomainStore.getState()
      expect(state.activeSessionId).toBe(id)
      // simulate what ChatPane does via useActiveMessages
      const messages = state.sessions.find((s) => s.id === state.activeSessionId)?.messages ?? []
      expect(Array.isArray(messages)).toBe(true)
    }
  })

  it('click session then send message should not throw', () => {
    // Click on s2 (which has no messages initially)
    useDomainStore.getState().selectSession('s2')
    // Simulate send via appendUserMessage + domain apply
    useDomainStore.getState().appendUserMessage('s2', 'hello')
    useDomainStore.getState().apply({ type: 'agent:started', sessionId: 's2', agentId: 'a0', role: 'supervisor' })
    useDomainStore.getState().apply({ type: 'token:stream', sessionId: 's2', agentId: 'a0', delta: 'world' })

    const state = useDomainStore.getState()
    const msgs = state.sessions.find((s) => s.id === 's2')!.messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].content).toBe('world')
  })
})
