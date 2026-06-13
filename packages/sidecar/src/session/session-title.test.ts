import { describe, it, expect, beforeEach } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import { Session, sanitizeTitle } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }
function textRunner(text: string): ModelRunner {
  return { async run(_m: BaseMessage[], o: ModelRunOptions) { o.onText(text); return new AIMessage(text) } }
}

describe('Session auto-title', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('pushes a session:title with the truncated first message (no LLM when a model is injected)', async () => {
    const sent: ServerMessage[] = []
    await new Session('s1', cfg, undefined, st, undefined, undefined, textRunner('hi')).sendMessage('给会话加重命名能力', (m) => sent.push(m), 'u-1')
    const titles = sent.filter((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>[]
    expect(titles).toHaveLength(1)
    expect(titles[0].title).toContain('给会话加重命名能力')
    expect(st.getSession('s1')!.title).toContain('给会话加重命名能力')
  })

  it('refines the title via the generator after the first reply', async () => {
    const sent: ServerMessage[] = []
    const gen = async () => '重命名与自动标题'
    await new Session('s1', cfg, undefined, st, gen, undefined, textRunner('some reply')).sendMessage('帮我加个功能', (m) => sent.push(m), 'u-1')
    const titles = sent.filter((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>[]
    expect(titles).toHaveLength(2)               // instant truncate, then refine
    expect(titles.at(-1)!.title).toBe('重命名与自动标题')
    expect(st.getSession('s1')!.title).toBe('重命名与自动标题')
  })

  it('does not overwrite a user-pinned title', async () => {
    st.setCustomTitle('s1', '我的标题')
    const sent: ServerMessage[] = []
    const gen = async () => '生成的标题'
    await new Session('s1', cfg, undefined, st, gen, undefined, textRunner('reply')).sendMessage('问题', (m) => sent.push(m), 'u-1')
    expect(sent.some((m) => m.type === 'session:title')).toBe(false)
    expect(st.getSession('s1')!.title).toBe('我的标题')
  })

  it('sanitizeTitle strips quotes/trailing punctuation, collapses whitespace, truncates', () => {
    expect(sanitizeTitle('  "Hello  World"  ')).toBe('Hello World')
    expect(sanitizeTitle('标题。')).toBe('标题')
    expect(sanitizeTitle('x'.repeat(50))).toHaveLength(40)
  })
})
