import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import { Session, sanitizeTitle } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import {
  buildTitleSystemPrompt,
  deriveTitle,
  titleLanguageLabel,
  type TitleGenerator,
} from './title-generator.js'
import { ROUNDTABLE_MARKER, ROUNDTABLE_SEP } from './roundtable/constants.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }
function textRunner(text: string): ModelRunner {
  return { async run(_m: BaseMessage[], o: ModelRunOptions) { o.onText(text); return new AIMessage(text) } }
}

describe('deriveTitle', () => {
  it('strips roundtable wire frame', () => {
    const wire = `${ROUNDTABLE_MARKER}\nframe${ROUNDTABLE_SEP}Should we rewrite the API?`
    expect(deriveTitle(wire)).toBe('Should we rewrite the API?')
  })
})

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

  it('passes session config language into the title generator', async () => {
    st.insertSession({
      id: 's-lang',
      title: '新对话',
      config: JSON.stringify({ ...cfg, language: 'ja' as const }),
      createdAt: 1,
      updatedAt: 1,
    })
    const gen = vi.fn<TitleGenerator>(async () => 'タイトル')
    const sent: ServerMessage[] = []
    await new Session(
      's-lang',
      { ...cfg, language: 'ja' },
      undefined,
      st,
      gen,
      undefined,
      textRunner('reply'),
    ).sendMessage('hello world', (m) => sent.push(m), 'u-1')
    expect(gen).toHaveBeenCalledWith(
      expect.objectContaining({
        firstUserMessage: 'hello world',
        language: 'ja',
      }),
    )
    const titles = sent.filter((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>[]
    expect(titles.at(-1)!.title).toBe('タイトル')
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

describe('title language prompt', () => {
  it('labels each app language', () => {
    expect(titleLanguageLabel('en')).toContain('English')
    expect(titleLanguageLabel('zh-CN')).toContain('Simplified Chinese')
    expect(titleLanguageLabel('zh-TW')).toContain('Traditional Chinese')
    expect(titleLanguageLabel('ja')).toContain('Japanese')
    expect(titleLanguageLabel('ko')).toContain('Korean')
  })

  it('instructs the model to use app UI language, not message language', () => {
    const p = buildTitleSystemPrompt('ko')
    expect(p).toContain('Korean (ko)')
    expect(p).toContain('ko')
    expect(p).toMatch(/app UI language/i)
    expect(p).not.toMatch(/same language as the user/i)
  })

  it('defaults prompt language to English', () => {
    expect(buildTitleSystemPrompt()).toContain('English (en)')
  })
})

