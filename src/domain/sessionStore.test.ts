// src/domain/sessionStore.test.ts
import { describe, it, expect } from 'vitest'
import { applyServerMessage, useDomainStore, type SessionVM } from './sessionStore'

function baseSession(over: Partial<SessionVM> = {}): SessionVM {
  return {
    id: 's1',
    config: { llmProvider: 'deepseek', model: 'm', tools: [] },
    title: 'T',
    preview: 'P',
    updatedAt: 'now',
    messages: [],
    agents: [],
    status: 'idle',
    ...over,
  }
}

describe('applyServerMessage', () => {
  it('agent:started adds a running agent with derived title and startedAt', () => {
    const next = applyServerMessage(
      { sessions: [baseSession()] },
      { type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'planner' },
      1000,
    )
    const a = next.sessions[0].agents[0]
    expect(a).toMatchObject({ id: 'a1', role: 'planner', title: 'Planner', status: 'running', startedAt: 1000 })
    expect(next.sessions[0].status).toBe('running')
  })

  it('token:stream accumulates agent tokens and tokenCount', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a1', role: 'planner', title: 'Planner', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'a1', delta: 'abc' }, 0)
    expect(next.sessions[0].agents[0].tokens).toBe('abc')
    expect(next.sessions[0].agents[0].tokenCount).toBe(3)
  })

  it('token:stream from a supervisor also streams into a new assistant message', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0 }], messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'a0', delta: 'Hel' }, 5)
    const msgs = next.sessions[0].messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'Hel' })
  })

  it('supervisor token appends to the existing streaming assistant message', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'running', tokens: 'Hel', tokenCount: 3, elapsedMs: 0, startedAt: 0 }], messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'Hel', timestamp: 5 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'a0', delta: 'lo' }, 6)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].messages[1].content).toBe('Hello')
  })

  it('agent:finished marks done and materializes elapsedMs', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a1', role: 'planner', title: 'Planner', status: 'running', tokens: 'x', tokenCount: 1, elapsedMs: 0, startedAt: 1000 }] })] }
    const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 's1', agentId: 'a1' }, 3400)
    expect(next.sessions[0].agents[0]).toMatchObject({ status: 'done', elapsedMs: 2400 })
  })

  it('message:complete replaces the streaming assistant message', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'partial', timestamp: 5 }] })] }
    const final = { id: 'final', role: 'assistant' as const, content: 'full reply', timestamp: 9 }
    const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: final }, 9)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].messages[1]).toEqual(final)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('ignores events for unknown sessions', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 'nope', agentId: 'a1' }, 0)
    expect(next.sessions[0].agents).toHaveLength(0)
  })

  it('session:created adds an empty session and ignores duplicates', () => {
    const s0 = { sessions: [baseSession()] }
    const added = applyServerMessage(s0, { type: 'session:created', sessionId: 's2' }, 0)
    expect(added.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    const dup = applyServerMessage(added, { type: 'session:created', sessionId: 's1' }, 0)
    expect(dup.sessions).toHaveLength(2)
  })

  it('token:stream for an unknown agent is a no-op (arrives before agent:started)', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'ghost', delta: 'x' }, 0)
    expect(next.sessions[0].agents).toHaveLength(0)
    expect(next.sessions[0].messages).toHaveLength(1)
  })
})

function reset() {
  useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
}

describe('useDomainStore actions', () => {
  it('createSession prepends and activates', () => {
    reset()
    const id = useDomainStore.getState().createSession('s-new', { llmProvider: 'deepseek', model: 'm', tools: [] })
    expect(useDomainStore.getState().sessions[0].id).toBe(id)
    expect(useDomainStore.getState().activeSessionId).toBe(id)
  })

  it('appendUserMessage adds a user message to the session', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().appendUserMessage('s1', 'hello')
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('deleteSession removes and reassigns active', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().createSession('s2', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().deleteSession('s2')
    expect(useDomainStore.getState().sessions.map((s) => s.id)).toEqual(['s1'])
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
  })

  it('apply routes a ServerMessage through the reducer', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().apply({ type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'coder' })
    expect(useDomainStore.getState().sessions[0].agents[0].title).toBe('Coder')
  })
})
