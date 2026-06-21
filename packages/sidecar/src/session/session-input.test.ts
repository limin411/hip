import { describe, it, expect } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

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
})
