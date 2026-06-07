import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }

describe('Session auto-title', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('pushes a session:title with the truncated first message (no LLM when a model is injected)', async () => {
    const sent: ServerMessage[] = []
    const model = new FakeListChatModel({ responses: ['hi'] })
    await new Session('s1', cfg, model, st).sendMessage('给会话加重命名能力', (m) => sent.push(m), 'u-1')
    const titles = sent.filter((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>[]
    expect(titles).toHaveLength(1)
    expect(titles[0].title).toContain('给会话加重命名能力')
    expect(st.getSession('s1')!.title).toContain('给会话加重命名能力')
  })
})
