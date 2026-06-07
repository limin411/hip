import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Session } from './session.js'

type Ev = { type: string; [k: string]: unknown }

function collect(session: Session, text: string): Promise<Ev[]> {
  const events: Ev[] = []
  return session.sendMessage(text, (m) => events.push(m as Ev)).then(() => events)
}

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
