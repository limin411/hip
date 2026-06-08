import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Session, resolveModel } from './session.js'

type Ev = { type: string; [k: string]: unknown }

function collect(session: Session, text: string): Promise<Ev[]> {
  const events: Ev[] = []
  return session.sendMessage(text, (m) => events.push(m as Ev)).then(() => events)
}

describe('resolveModel', () => {
  it('returns deepseek-reasoner when model is empty and thinking is true', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: '', tools: [], thinking: true })).toBe('deepseek-reasoner')
  })

  it('returns deepseek-chat when model is empty and thinking is false', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: '', tools: [], thinking: false })).toBe('deepseek-chat')
  })

  it('returns deepseek-reasoner when model is empty and thinking is undefined (defaults to reasoner)', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: '', tools: [] })).toBe('deepseek-reasoner')
  })

  it('returns the explicit model when model is set, even if thinking is true', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true })).toBe('deepseek-chat')
  })
})

describe('Session.setThinking', () => {
  it('returns true and updates config when session is idle', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-thinking-idle', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true }, model)
    const applied = session.setThinking(false)
    expect(applied).toBe(true)
    expect(session.config.thinking).toBe(false)
  })

  it('returns false and leaves config unchanged when a turn is running', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-thinking-running', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true }, model)
    // Simulate a running turn by setting the private field via type cast.
    ;(session as unknown as { running: boolean }).running = true
    const applied = session.setThinking(false)
    expect(applied).toBe(false)
    expect(session.config.thinking).toBe(true)
  })
})

describe('Session NO_API_KEY guard', () => {
  let saved: string | undefined
  beforeEach(() => { saved = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY })
  afterEach(() => { if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved })

  it('emits NO_API_KEY and no agent:started when key is absent and no model is injected', async () => {
    const session = new Session('t-nokey', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const events = await collect(session, 'hi')
    expect(events.some((e) => e.type === 'agent:started')).toBe(false)
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as Ev).code).toBe('NO_API_KEY')
  })

  it('runs normally when a model is injected (guard skipped)', async () => {
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('t-fake', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    const events = await collect(session, 'hi')
    expect(events[0]?.type).toBe('agent:started')
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})
