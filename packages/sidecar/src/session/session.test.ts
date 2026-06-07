// packages/sidecar/src/session/session.test.ts
import { describe, it, expect } from 'vitest'
import { ChatOpenAI } from '@langchain/openai'
import { Session } from './session.js'

const apiKey = process.env.DEEPSEEK_API_KEY
const hasKey = !!apiKey

function createModel() {
  return new ChatOpenAI({
    model: 'deepseek-chat',
    apiKey: apiKey!,
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
    temperature: 0,
    maxTokens: 64,
  })
}

type AnyServerMessage = { type: string; [k: string]: unknown }

async function collectEvents(session: Session, content: string): Promise<AnyServerMessage[]> {
  const events: AnyServerMessage[] = []
  await session.sendMessage(content, (msg) => events.push(msg as AnyServerMessage))
  return events
}

describe.skipIf(!hasKey)('Session with real DeepSeek API', () => {
  it('streams a single-turn response and emits complete protocol events', async () => {
    const session = new Session(
      'test-single',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
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
      'test-history',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      createModel(),
    )

    const events1 = await collectEvents(session, '我的名字是小明，请记住。')
    expect(events1.some((e) => e.type === 'message:complete')).toBe(true)

    const events2 = await collectEvents(session, '我刚才说了什么名字？只回答名字。')
    const complete2 = events2.find((e) => e.type === 'message:complete')
    expect(complete2).toBeDefined()
    expect(String((complete2 as any).message.content)).toMatch(/小明/)
  })

  it('emits error when canceled during streaming', async () => {
    const session = new Session(
      'test-cancel',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      createModel(),
    )

    const events: AnyServerMessage[] = []
    const promise = session.sendMessage('讲一个非常非常长的故事', (msg) =>
      events.push(msg as AnyServerMessage),
    )

    // Cancel as soon as the first token arrives
    const checkInterval = setInterval(() => {
      if (events.some((e) => e.type === 'token:stream')) {
        session.cancel()
        clearInterval(checkInterval)
      }
    }, 50)

    await promise
    clearInterval(checkInterval)

    expect(events.some((e) => e.type === 'error')).toBe(true)
  })
})
