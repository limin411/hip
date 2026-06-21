import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import type { SessionConfig } from '@hip/protocol'

type Ev = { type: string; [k: string]: unknown }

const cfg: SessionConfig = {
  llmProvider: 'openai',
  model: 'gpt-4',
  tools: [],
  useEventSource: true,
  disablePlan: true,
}

function store() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
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

function firstHangThenReply(reply: string): ModelRunner {
  let first = true
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      if (first) {
        first = false
        // Non-empty supervisorText lets a steer-aborted turn finalize its event projection,
        // preventing the next turn from stalling when messages are rebuilt from events.
        opts.onText('partial')
        return hang(opts.signal)
      }
      opts.onText(reply)
      return new AIMessage(reply)
    },
  }
}

async function untilRunning(s: Session): Promise<void> {
  const raw = s as unknown as { running: boolean }
  for (let i = 0; i < 100; i++) {
    if (raw.running) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('session never entered running state')
}

describe('Session input queue integration', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hip-input-queue-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('enqueues a message while a turn is running and processes it afterwards', async () => {
    const st = store()
    st.insertSession({ id: 's-queue-run', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    const sent: Ev[] = []
    const session = new Session('s-queue-run', { ...cfg, cwd: root }, undefined, st, undefined, 10_000, sequentialRunner(['first', 'second']))

    const p1 = session.sendMessage('msg1', (m) => sent.push(m as Ev))
    const p2 = session.sendMessage('msg2', (m) => sent.push(m as Ev))
    await Promise.all([p1, p2])

    const completes = sent.filter((m) => m.type === 'message:complete') as Array<{ message?: { content?: string } }>
    expect(completes.length).toBe(2)
    expect(completes[0].message?.content).toBe('first')
    expect(completes[1].message?.content).toBe('second')

    const stored = st.loadMessages('s-queue-run')
    expect(stored.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['msg1', 'msg2'])
  })

  it('steer while running interrupts the turn and stores the steer as a user message', async () => {
    const st = store()
    st.insertSession({ id: 's-steer-run', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    const sent: Ev[] = []
    const session = new Session('s-steer-run', { ...cfg, cwd: root }, undefined, st, undefined, 10_000, firstHangThenReply('steer-ack'))

    const turnPromise = session.sendMessage('original', (m) => sent.push(m as Ev))
    await untilRunning(session)

    session.enqueueInput({ type: 'steer', content: 'steer instead', messageId: 's-1' })
    await turnPromise

    // The original turn was aborted (no CANCELLED error) and at least one completion was emitted.
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
    expect(sent.some((m) => m.type === 'error' && (m as { code?: string }).code === 'CANCELLED')).toBe(false)

    const stored = st.loadMessages('s-steer-run')
    const steerMsg = stored.find((m) => m.id === 's-1')
    expect(steerMsg).toMatchObject({ id: 's-1', role: 'user', content: 'steer instead' })
  }, 15_000)

  it('drains an idle queue with enqueued messages', async () => {
    const st = store()
    st.insertSession({ id: 's-idle-drain', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    const sent: Ev[] = []
    const session = new Session('s-idle-drain', { ...cfg, cwd: root }, undefined, st, undefined, 10_000, sequentialRunner(['idle-ack']))

    await session.sendMessage('first', (m) => sent.push(m as Ev))
    session.enqueueInput({ type: 'message', content: 'second', messageId: 'q-2' })
    await session.drainInputQueue((m) => sent.push(m as Ev))

    const completes = sent.filter((m) => m.type === 'message:complete')
    expect(completes.length).toBe(2)

    const raw = session as unknown as { inputQueue: Array<unknown> }
    expect(raw.inputQueue).toHaveLength(0)
  })

  it('drops older queued messages when a newer steer is promoted', async () => {
    const st = store()
    st.insertSession({ id: 's-steer-drop', title: 'test', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    const session = new Session('s-steer-drop', { ...cfg, cwd: root }, undefined, st, undefined, 10_000, sequentialRunner(['ok']))

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
