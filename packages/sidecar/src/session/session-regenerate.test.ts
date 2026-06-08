import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }

describe('Session.regenerate', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('deletes the last assistant turn and re-runs (one assistant message remains)', async () => {
    const session = new Session('s1', cfg, new FakeListChatModel({ responses: ['answer'] }), st)
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
    const session = new Session('s1', cfg, new FakeListChatModel({ responses: ['recovered'] }), st)
    session.hydrate(st.loadMessages('s1')) // this.messages = [HumanMessage('hi')]

    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))

    const msgs = st.loadMessages('s1')
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })

  it('is a no-op on an empty session (nothing to redo)', async () => {
    const session = new Session('s1', cfg, new FakeListChatModel({ responses: ['x'] }), st)
    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))
    expect(events).toHaveLength(0)
    expect(st.loadMessages('s1')).toHaveLength(0)
  })
})
