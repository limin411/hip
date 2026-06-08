import { describe, it, expect } from 'vitest'
import { ChatOpenAI } from '@langchain/openai'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const apiKey = process.env.DEEPSEEK_API_KEY

function createModel() {
  return new ChatOpenAI({
    model: 'deepseek-chat',
    apiKey,
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
    temperature: 0,
  })
}

type Ev = { type: string; [k: string]: unknown }

function startedRoles(events: Ev[]): Set<string> {
  return new Set(
    events.filter((e) => e.type === 'agent:started').map((e) => String(e.role)),
  )
}

function startedIds(events: Ev[]): string[] {
  return events.filter((e) => e.type === 'agent:started').map((e) => String(e.agentId))
}

function finishedIds(events: Ev[]): Set<string> {
  return new Set(
    events.filter((e) => e.type === 'agent:finished').map((e) => String(e.agentId)),
  )
}

describe.skipIf(!apiKey)('Session real multi-agent orchestration (DeepSeek)', () => {
  it(
    'delegates to subagents and emits paired started/finished + a final message',
    async () => {
      const session = new Session(
        'it-delegate',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
        createModel(),
      )

      const events: Ev[] = []
      await session.sendMessage(
        'Plan, implement, and review a TypeScript function that reverses a string.',
        (m) => events.push(m as Ev),
      )

      // Supervisor + at least one sub-agent were announced.
      const roles = startedRoles(events)
      expect(roles.size).toBeGreaterThan(1)
      expect(roles.has('supervisor')).toBe(true)

      // Tokens streamed.
      expect(events.some((e) => e.type === 'token:stream')).toBe(true)

      // Every started agent has a matching finished (no agent left hanging).
      const finished = finishedIds(events)
      for (const id of startedIds(events)) {
        expect(finished.has(id)).toBe(true)
      }

      // A synthesized final answer was produced.
      expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    },
    90_000,
  )

  it(
    'on cancel emits CANCELLED and closes out every started agent',
    async () => {
      const session = new Session(
        'it-cancel',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
        createModel(),
      )

      const events: Ev[] = []
      const promise = session.sendMessage(
        'Plan, implement, and review a very long, detailed TypeScript module with many functions.',
        (m) => events.push(m as Ev),
      )

      // Cancel as soon as the first token arrives.
      const checkInterval = setInterval(() => {
        if (events.some((e) => e.type === 'token:stream')) {
          session.cancel()
          clearInterval(checkInterval)
        }
      }, 50)

      await promise
      clearInterval(checkInterval)

      // Task 6: on cancel with tokens received, we persist the partial (message:complete, stopped=true).
      // An empty partial (no tokens yet) still emits CANCELLED.
      const hasPartial = events.some((e) => e.type === 'token:stream')
      if (hasPartial) {
        const complete = events.find((e) => e.type === 'message:complete') as (Ev & { message?: { stopped?: boolean } }) | undefined
        expect(complete).toBeDefined()
        expect(complete?.message?.stopped).toBe(true)
      } else {
        const err = events.find((e) => e.type === 'error')
        expect(err).toBeDefined()
        expect((err as Ev).code).toBe('CANCELLED')
      }

      // No agent left hanging: every started agent got a finished.
      const finished = finishedIds(events)
      for (const id of startedIds(events)) {
        expect(finished.has(id)).toBe(true)
      }
    },
    90_000,
  )

  it(
    'on cancel keeps the partial reply, persisted with stopped=true',
    async () => {
      const { db, ftsEnabled } = openDatabase(':memory:')
      const store = new SessionStore(db, ftsEnabled)
      store.insertSession({ id: 'it-cancel-persist', title: '新对话', config: JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }), createdAt: 1, updatedAt: 1 })
      const session = new Session('it-cancel-persist', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, createModel(), store)

      const events: Ev[] = []
      const promise = session.sendMessage('Write a very long, detailed TypeScript module with many functions.', (m) => events.push(m as Ev), 'u1')
      const checkInterval = setInterval(() => {
        if (events.some((e) => e.type === 'token:stream')) { session.cancel(); clearInterval(checkInterval) }
      }, 50)
      await promise
      clearInterval(checkInterval)

      const hasPartial = events.some((e) => e.type === 'token:stream')
      const msgs = store.loadMessages('it-cancel-persist')
      const asst = msgs.find((m) => m.role === 'assistant')
      if (hasPartial) {
        // Cancel landed mid-stream → the partial is finalized and persisted as stopped.
        expect(asst).toBeDefined()
        expect(asst!.stopped).toBe(true)
        expect((asst!.content ?? '').length).toBeGreaterThan(0)
        expect(events.some((e) => e.type === 'message:complete')).toBe(true)
      } else {
        // Cancel landed before any token → nothing persisted, CANCELLED surfaced.
        expect(asst).toBeUndefined()
        expect(events.some((e) => e.type === 'error' && (e as Ev).code === 'CANCELLED')).toBe(true)
      }
    },
    90_000,
  )
})
