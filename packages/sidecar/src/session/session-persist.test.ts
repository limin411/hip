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

describe('Session persistence', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('persists the user message and the assistant turn', async () => {
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('hello world'))
    await session.sendMessage('hi there', () => {}, 'u-1')
    const msgs = st.loadMessages('s1')
    expect(msgs[0]).toMatchObject({ id: 'u-1', role: 'user', content: 'hi there' })
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: 'hello world' })
  })

  it('derives the session title from the first user message', async () => {
    await new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('ok')).sendMessage('给会话加持久化', () => {}, 'u-1')
    expect(st.getSession('s1')!.title).toContain('给会话加持久化')
  })

  it('hydrate() seeds prior history so a follow-up turn has context', async () => {
    st.insertMessage({ id: 'u0', sessionId: 's1', role: 'user', agentId: null, content: '我叫小明', timestamp: 1 })
    st.insertMessage({ id: 'a0', sessionId: 's1', role: 'assistant', agentId: 'supervisor', content: '好的', timestamp: 2 })
    const session = new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('小明'))
    session.hydrate(st.loadMessages('s1'))
    const events: { type: string }[] = []
    await session.sendMessage('我叫什么', (m) => events.push(m), 'u1')
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(st.loadMessages('s1').map((m) => m.id)).toContain('u0')
  })
})
