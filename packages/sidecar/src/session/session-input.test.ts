import { describe, it, expect } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { SessionInputQueue } from './session-input.js'

type Ev = { type: string; [k: string]: unknown }

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], disablePlan: true }

function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }

function textRunner(text: string): ModelRunner {
  return { async run(_m: BaseMessage[], o: ModelRunOptions) { o.onText(text); return new AIMessage(text) } }
}

function hang(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => {
      const e = new Error('Aborted')
      e.name = 'AbortError'
      reject(e)
    }
    if (signal?.aborted) return fail()
    signal?.addEventListener('abort', fail, { once: true })
  })
}

async function untilRunning(s: Session): Promise<void> {
  const raw = s as unknown as { running: boolean }
  for (let i = 0; i < 100; i++) {
    if (raw.running) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('session never entered running state')
}

function sequentialRunner(responses: string[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], o: ModelRunOptions): Promise<AIMessage> {
      const text = responses[i++ % responses.length]
      o.onText(text)
      return new AIMessage(text)
    },
  }
}

function firstHangThenReply(reply: string): ModelRunner {
  let first = true
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      if (first) {
        first = false
        return hang(opts.signal)
      }
      opts.onText(reply)
      return new AIMessage(reply)
    },
  }
}

describe('Session input queue', () => {
  describe('sendMessage while running', () => {
    it('enqueues the second message and processes it after the current turn', async () => {
      const sent: Ev[] = []
      const session = new Session('t-queue-second', cfg, undefined, undefined, undefined, 10_000, sequentialRunner(['first', 'second']))

      const p1 = session.sendMessage('msg1', (m) => sent.push(m as Ev))
      const p2 = session.sendMessage('msg2', (m) => sent.push(m as Ev))
      await Promise.all([p1, p2])

      const completes = sent.filter((m) => m.type === 'message:complete') as Array<{ message?: { content?: string } }>
      expect(completes.length).toBe(2)
      expect(completes[0].message?.content).toBe('first')
      expect(completes[1].message?.content).toBe('second')
    })
  })

  describe('two rapid messages', () => {
    it('processes both messages in order', async () => {
      const sent: Ev[] = []
      const session = new Session('t-queue-order', cfg, undefined, undefined, undefined, 10_000, sequentialRunner(['one', 'two']))

      const p1 = session.sendMessage('a', (m) => sent.push(m as Ev))
      const p2 = session.sendMessage('b', (m) => sent.push(m as Ev))
      await Promise.all([p1, p2])

      const completes = sent.filter((m) => m.type === 'message:complete') as Array<{ message?: { content?: string } }>
      expect(completes.length).toBe(2)
      expect(completes[0].message?.content).toBe('one')
      expect(completes[1].message?.content).toBe('two')
    })
  })

  describe('steer while running', () => {
    it('interrupts the current turn and the steer becomes the next user message', async () => {
      const sent: Ev[] = []
      const session = new Session('t-steer-interrupt', cfg, undefined, undefined, undefined, 10_000, firstHangThenReply('steer-ack'))

      const turnPromise = session.sendMessage('original', (m) => sent.push(m as Ev))
      await untilRunning(session)

      session.enqueueInput({ type: 'steer', content: 'steer instead', messageId: 's-1' })
      await turnPromise

      expect(sent.some((m) => m.type === 'error' && (m as Ev).code === 'CANCELLED')).toBe(false)
      const completes = sent.filter((m) => m.type === 'message:complete') as Array<{ message?: { content?: string } }>
      expect(completes.length).toBeGreaterThanOrEqual(1)
      expect(completes[completes.length - 1].message?.content).toBe('steer-ack')
    })

    it('promotes the most recent steer and drops older queued messages', async () => {
      const session = new Session('t-steer-promote', cfg, undefined, undefined, undefined, 10_000, sequentialRunner(['ok']))
      session.enqueueInput({ type: 'message', content: 'older1' })
      session.enqueueInput({ type: 'message', content: 'older2' })
      session.enqueueInput({ type: 'steer', content: 'steer1' })
      session.enqueueInput({ type: 'message', content: 'newer1' })
      session.enqueueInput({ type: 'steer', content: 'steer2' })

      const promoted = session.promoteSteerInput()
      expect(promoted?.content).toBe('steer2')
      const raw = session as unknown as { inputQueue: Array<{ content: string }> }
      expect(raw.inputQueue.map((i) => i.content)).toEqual([])
    })
  })

  describe('steer persistence', () => {
    it('persists the steer as a user_message event', async () => {
      const st = store()
      st.insertSession({ id: 's-steer', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const session = new Session('s-steer', cfg, undefined, st, undefined, undefined, textRunner('ack'))

      await session.sendMessage('hello', () => {}, 'u-1')
      session.enqueueInput({ type: 'steer', content: 'change direction', messageId: 's-1' })
      await session.drainInputQueue(() => {})

      const msgs = st.loadMessages('s-steer')
      const steerMsg = msgs.find((m) => m.id === 's-1')
      expect(steerMsg).toMatchObject({ id: 's-1', role: 'user', content: 'change direction' })
    })
  })

  describe('queue cleared after processing', () => {
    it('leaves the input queue empty after all inputs are drained', async () => {
      const sent: Ev[] = []
      const session = new Session('t-queue-cleared', cfg, undefined, undefined, undefined, 10_000, sequentialRunner(['a', 'b']))

      await session.sendMessage('first', (m) => sent.push(m as Ev))
      session.enqueueInput({ type: 'message', content: 'second', messageId: 'q-2' })
      await session.drainInputQueue((m) => sent.push(m as Ev))

      const raw = session as unknown as { inputQueue: Array<unknown> }
      expect(raw.inputQueue).toHaveLength(0)
      const completes = sent.filter((m) => m.type === 'message:complete')
      expect(completes.length).toBe(2)
    })
  })

  describe('messageId collision', () => {
    it('uses the original ID when no collision exists', () => {
      const st = store()
      st.insertSession({ id: 's-col-1', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const queue = new SessionInputQueue(st, 's-col-1')

      const id = queue.admit({ type: 'message', content: 'hello', messageId: 'unique-1' })
      expect(id).toBe('unique-1')
    })

    it('appends a counter suffix when an explicit messageId collides', () => {
      const st = store()
      st.insertSession({ id: 's-col-2', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const queue = new SessionInputQueue(st, 's-col-2')

      const id1 = queue.admit({ type: 'message', content: 'first', messageId: 'dup' })
      const id2 = queue.admit({ type: 'message', content: 'second', messageId: 'dup' })
      expect(id1).toBe('dup')
      expect(id2).toBe('dup-1')
    })

    it('increments the suffix for multiple collisions', () => {
      const st = store()
      st.insertSession({ id: 's-col-3', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const queue = new SessionInputQueue(st, 's-col-3')

      const id1 = queue.admit({ type: 'message', content: 'a', messageId: 'dup' })
      const id2 = queue.admit({ type: 'message', content: 'b', messageId: 'dup' })
      const id3 = queue.admit({ type: 'message', content: 'c', messageId: 'dup' })
      expect(id1).toBe('dup')
      expect(id2).toBe('dup-1')
      expect(id3).toBe('dup-2')
    })

    it('handles collisions against already-suffixed IDs', () => {
      const st = store()
      st.insertSession({ id: 's-col-4', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const queue = new SessionInputQueue(st, 's-col-4')

      queue.admit({ type: 'message', content: 'a', messageId: 'dup' })
      queue.admit({ type: 'message', content: 'b', messageId: 'dup' })
      const id3 = queue.admit({ type: 'message', content: 'c', messageId: 'dup-1' })
      expect(id3).toBe('dup-1-1')
    })

    it('avoids collisions for auto-generated IDs when many inputs are admitted rapidly', () => {
      const st = store()
      st.insertSession({ id: 's-col-5', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const queue = new SessionInputQueue(st, 's-col-5')

      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const id = queue.admit({ type: 'message', content: String(i) })
        ids.add(id)
      }
      expect(ids.size).toBe(100)
    })

    it('returns distinct IDs when admitting many inputs with the same messageId', () => {
      const st = store()
      st.insertSession({ id: 's-col-6', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
      const queue = new SessionInputQueue(st, 's-col-6')

      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const id = queue.admit({ type: 'message', content: String(i), messageId: 'bulk' })
        ids.add(id)
      }
      expect(ids.size).toBe(50)
      expect(ids.has('bulk')).toBe(true)
      expect(ids.has('bulk-1')).toBe(true)
      expect(ids.has('bulk-49')).toBe(true)
    })
  })
})
