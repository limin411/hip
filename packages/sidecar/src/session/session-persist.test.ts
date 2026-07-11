import { describe, it, expect, beforeEach } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { EventStore } from '../persistence/event-store.js'
import { MemoryStore } from '../memory/store.js'
import { MemoryService } from '../memory/service.js'
import { finalizeAndPersistTurn } from './session-persist.js'
import type { ServerMessage } from '@hip/protocol'

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

  it('finalize strips citation fence, persists memoryCitations, bumps use_count once (not on load)', () => {
    const db = st.getDb()
    const memStore = new MemoryStore(db, false)
    const memSvc = new MemoryService(memStore)
    memStore.upsertItem({
      id: 'mem-yarn',
      scope: 'project',
      kind: 'preference',
      title: 'Prefer yarn',
      content: 'use yarn',
      confidence: 0.9,
      status: 'active',
      source: 'user',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      useCount: 0,
      pinned: false,
      projectKeyHash: 'pkh',
    })

    const body = [
      'Use yarn for package installs.',
      '```hip-memory-citations',
      '[{"memoryId":"mem-yarn","title":"Prefer yarn"}]',
      '```',
    ].join('\n')

    const events: ServerMessage[] = []
    const messages: BaseMessage[] = [new AIMessage(body)]
    const finalText = finalizeAndPersistTurn(
      {
        id: 's1',
        store: st,
        eventStore: new EventStore(db),
        config: cfg,
        messages,
        memoryService: memSvc,
      },
      (m) => events.push(m),
      'turn-cite',
      body,
      new Map(),
      false,
    )

    expect(finalText).toBe('Use yarn for package installs.')
    expect(finalText).not.toContain('hip-memory-citations')

    const complete = events.find((e) => e.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(complete.message.content).toBe('Use yarn for package installs.')
    expect(complete.message.memoryCitations).toEqual([{ memoryId: 'mem-yarn', title: 'Prefer yarn' }])

    const loaded = st.loadMessages('s1').find((m) => m.id === 'turn-cite')!
    expect(loaded.content).toBe('Use yarn for package installs.')
    expect(loaded.memoryCitations).toEqual([{ memoryId: 'mem-yarn', title: 'Prefer yarn' }])

    expect(memStore.getItem('mem-yarn')!.useCount).toBe(1)
    // Reload must not re-bump.
    st.loadMessages('s1')
    st.loadMessagesWithRuns('s1')
    expect(memStore.getItem('mem-yarn')!.useCount).toBe(1)
  })
})
