// packages/sidecar/src/session/session-anthropic.test.ts
import { describe, it, expect } from 'vitest'
import { ChatAnthropic } from '@langchain/anthropic'
import { Session } from './session.js'

const apiKey = process.env.HIP_MODEL_ANTHROPIC_API_KEY
const hasKey = !!apiKey

function createModel() {
  return new ChatAnthropic({
    model: 'claude-3-haiku-20240307',
    apiKey: apiKey!,
    streaming: true,
  })
}

type AnyServerMessage = { type: string; [k: string]: unknown }

async function collectEvents(session: Session, content: string): Promise<AnyServerMessage[]> {
  const events: AnyServerMessage[] = []
  await session.sendMessage(content, (msg) => events.push(msg as AnyServerMessage))
  return events
}

describe.skipIf(!hasKey)('Session with real Anthropic API', () => {
  it('streams a single-turn response and emits complete protocol events', async () => {
    const session = new Session(
      'test-anthropic-single',
      { llmProvider: 'anthropic', model: 'claude-3-haiku-20240307', tools: [] },
      createModel(),
    )

    const events = await collectEvents(session, '1+1等于几？只回答数字')

    expect(events[0]?.type).toBe('agent:started')
    expect(events.some((e) => e.type === 'token:stream')).toBe(true)
    expect(events.some((e) => e.type === 'agent:finished')).toBe(true)

    const complete = events.find((e) => e.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(String((complete as any).message.content)).toContain('2')
  })

  it('remembers conversation history across multiple turns', async () => {
    const session = new Session(
      'test-anthropic-history',
      { llmProvider: 'anthropic', model: 'claude-3-haiku-20240307', tools: [] },
      createModel(),
    )

    const events1 = await collectEvents(session, '我的名字是小明，请记住。')
    expect(events1.some((e) => e.type === 'message:complete')).toBe(true)

    const events2 = await collectEvents(session, '我刚才说了什么名字？只回答名字。')
    const complete2 = events2.find((e) => e.type === 'message:complete')
    expect(complete2).toBeDefined()
    expect(String((complete2 as any).message.content)).toMatch(/小明/)
  })
})
