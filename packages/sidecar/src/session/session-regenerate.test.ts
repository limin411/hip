import { describe, it, expect, beforeEach } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }
function textRunner(text: string): ModelRunner {
  return { async run(_m: BaseMessage[], o: ModelRunOptions) { o.onText(text); return new AIMessage(text) } }
}

describe('Session.regenerate', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('deletes the last assistant turn and re-runs (one assistant message remains)', async () => {
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('answer'))
    await session.sendMessage('hi', () => {}, 'u1')
    expect(st.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)

    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))

    const msgs = st.loadMessages('s1')
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1) // old deleted, one new
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'agent:started')).toBe(true)
  })

  it('re-runs without deleting when the last message is a user message (retry-after-error)', async () => {
    st.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('recovered'))
    session.hydrate(st.loadMessages('s1')) // this.messages = [HumanMessage('hi')]

    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))

    const msgs = st.loadMessages('s1')
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })

  it('is a no-op on an empty session (nothing to redo)', async () => {
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('x'))
    const events: { type: string; code?: string }[] = []
    await session.regenerate((m) => events.push(m as { type: string; code?: string }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'CANNOT_REGENERATE' })
    expect(st.loadMessages('s1')).toHaveLength(0)
  })

  it('surfaces BUSY error when a turn is already running instead of wedging', async () => {
    st.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('x'))
    session.hydrate(st.loadMessages('s1'))
    ;(session as unknown as { running: boolean }).running = true

    const events: { type: string; code?: string }[] = []
    await session.regenerate((m) => events.push(m as { type: string; code?: string }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'BUSY' })
    expect(st.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(0)
  })

  it('strips all trailing assistant messages and re-runs from the last user turn', async () => {
    st.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    st.insertMessage({ id: 'a1', sessionId: 's1', role: 'assistant', agentId: null, content: 'first', timestamp: 2 })
    st.insertMessage({ id: 'a2', sessionId: 's1', role: 'assistant', agentId: null, content: 'second', timestamp: 3 })
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('answer'))
    session.hydrate(st.loadMessages('s1'))

    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))

    const msgs = st.loadMessages('s1')
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'agent:started')).toBe(true)
  })

  it('when awaitingResume, regenerate clears the paused state and runs a new turn', async () => {
    st.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    st.insertMessage({ id: 'a1', sessionId: 's1', role: 'assistant', agentId: null, content: 'old', timestamp: 2 })
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('x'))
    session.hydrate(st.loadMessages('s1'))
    ;(session as unknown as { awaitingResume: boolean }).awaitingResume = true

    const events: { type: string; code?: string }[] = []
    await session.regenerate((m) => events.push(m as { type: string; code?: string }))

    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(st.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect((session as unknown as { awaitingResume: boolean }).awaitingResume).toBe(false)
  })
})
