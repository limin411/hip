import { describe, it, expect, vi, afterEach } from 'vitest'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { loadProjection } from '../persistence/message-projector.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeRunnerSession(id: string, runner: ModelRunner, cwd?: string): Session {
  return new Session(
    id,
    { llmProvider: 'deepseek', model: 'm', tools: [], cwd: cwd ?? process.cwd() },
    undefined, undefined, undefined, undefined,
    runner,
  )
}

function inMemoryStore(): SessionStore {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

function makeRunnerSessionWithStore(id: string, runner: ModelRunner, store: SessionStore): Session {
  store.insertSession({ id, title: 'test', config: JSON.stringify({ llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() }), createdAt: Date.now(), updatedAt: Date.now() })
  return new Session(id, { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() }, undefined, store, undefined, undefined, runner)
}

function collect(session: Session, text: string): Promise<ServerMessage[]> {
  const out: ServerMessage[] = []
  return new Promise<ServerMessage[]>((resolve) => {
    session
      .sendMessage(text, (m: ServerMessage) => { out.push(m); if (m.type === 'message:complete' || m.type === 'error') resolve(out) })
      .catch(() => resolve(out))
  })
}

/** True when the message list includes a ToolMessage — signals a main-turn continuation (the background
 *  sub-agent starts fresh with [SystemMessage, HumanMessage]). */
function hasToolMessages(msgs: BaseMessage[]): boolean {
  return msgs.some((m) => m instanceof ToolMessage)
}

describe('background subagent infrastructure', () => {
  it('Session.MAX_BACKGROUND_TASKS is 10', () => {
    expect(Session.MAX_BACKGROUND_TASKS).toBe(10)
  })

  it('listBackgroundTasks returns empty initially', () => {
    const session = new Session('bg-test', { llmProvider: 'dp', model: 'm', tools: [], cwd: process.cwd() })
    expect(session.listBackgroundTasks()).toEqual([])
    expect(session.backgroundTasks.size).toBe(0)
  })
})

describe('foreground subagent (no regression)', () => {
  it('does not populate backgroundTasks', async () => {
    class FgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'research X' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('done')
        return new AIMessage('done')
      }
    }
    const session = makeRunnerSession('s-fg', new FgRunner())
    const events = await collect(session, 'please research X')
    expect(events.find((e) => e.type === 'message:complete')).toBeTruthy()
    expect(session.backgroundTasks.size).toBe(0)
  })

  it('agent:started and agent:finished emitted for foreground task', async () => {
    class FgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'look' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('done')
        return new AIMessage('done')
      }
    }
    const session = makeRunnerSession('s-fg2', new FgRunner())
    const events = await collect(session, 'look')
    const started = events.filter((e) => e.type === 'agent:started' && (e as { agentId?: string }).agentId !== 'supervisor')
    const finished = events.filter((e) => e.type === 'agent:finished' && (e as { agentId?: string }).agentId !== 'supervisor')
    expect(started.length).toBeGreaterThanOrEqual(1)
    expect(finished.length).toBeGreaterThanOrEqual(1)
  })
})

describe('background subagent mode', () => {
  it('emits agent:started immediately and the main turn completes without waiting for the background task', async () => {
    // A runner whose first call issues a background-mode task, then returns text for the main
    // continuation. Background sub-agent calls (detected by absence of ToolMessages) are gated so
    // the test can observe backgroundTasks while the task is still in-flight.
    let releaseBg!: () => void
    const bgGate = new Promise<void>((r) => { releaseBg = r })

    class GatedBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'slow research', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        if (!hasToolMessages(msgs)) {
          // Background sub-agent: block until the test releases the gate
          await bgGate
        }
        opts.onText?.('done')
        return new AIMessage('done')
      }
    }

    const session = makeRunnerSession('s-bg', new GatedBgRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('run slow background research', (m) => events.push(m))

    // agent:started for the worker must already be emitted (non-blocking proof)
    const started = events.filter((e) => e.type === 'agent:started' && (e as { role?: string }).role === 'worker')
    expect(started.length).toBeGreaterThanOrEqual(1)

    // backgroundTasks must still hold the in-flight promise (it is blocked on bgGate)
    expect(session.backgroundTasks.size).toBe(1)
    expect(session.listBackgroundTasks().length).toBe(1)

    // Release the background sub-agent and wait for it to settle
    releaseBg()
    await Promise.allSettled(session.backgroundTasks.values())

    // After settling, backgroundTasks should be empty
    expect(session.backgroundTasks.size).toBe(0)
    expect(session.listBackgroundTasks()).toEqual([])

    // agent:finished for the worker should have been emitted
    const finished = events.filter((e) => e.type === 'agent:finished' && (e as { agentId?: string }).agentId?.startsWith('worker-'))
    expect(finished.length).toBeGreaterThanOrEqual(1)
  })

  it('enforces max concurrency — rejects the 11th background task', async () => {
    // Pre-populate backgroundTasks with 10 never-settling promises
    const session = makeRunnerSession('s-max', {
      async run() { return new AIMessage('unused') }
    } as ModelRunner)
    for (let i = 0; i < Session.MAX_BACKGROUND_TASKS; i++) {
      session.backgroundTasks.set(`pre-${i}`, new Promise(() => {}))
    }
    expect(session.backgroundTasks.size).toBe(10)

    // A runner that tries to spawn an 11th background task
    class OverflowRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'overflow', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('done')
        return new AIMessage('done')
      }
    }
    const session2 = makeRunnerSession('s-max2', new OverflowRunner())
    for (let i = 0; i < Session.MAX_BACKGROUND_TASKS; i++) {
      session2.backgroundTasks.set(`pre-${i}`, new Promise(() => {}))
    }

    const events = await collect(session2, 'start overflow task')

    // The 11th task was rejected — backgroundTasks size must NOT exceed 10
    expect(session2.backgroundTasks.size).toBe(10)

    // verify the turn completed
    expect(events.find((e) => e.type === 'message:complete')).toBeTruthy()
  })

  it('catches background task errors without unhandled rejection', async () => {
    // A runner where the background sub-agent throws (detected by absence of ToolMessages).
    class ErrorRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'boom', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        if (!hasToolMessages(msgs)) {
          throw new Error('simulated sub-agent crash')
        }
        opts.onText?.('main turn ok')
        return new AIMessage('main turn ok')
      }
    }

    const session = makeRunnerSession('s-err', new ErrorRunner())
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const events: ServerMessage[] = []
    await session.sendMessage('do something that crashes', (m) => events.push(m))

    // Wait for background task to settle (the error is caught inside spawnSubagent)
    await Promise.allSettled(session.backgroundTasks.values())

    // Background task should be cleaned up
    expect(session.backgroundTasks.size).toBe(0)

    // console.error should have been called with the background error
    const errCalls = consoleSpy.mock.calls.filter((c) => String(c[0]).includes('Background task'))
    expect(errCalls.length).toBeGreaterThanOrEqual(1)

    // agent:finished should have been emitted for the failed worker
    const workerFinished = events.filter(
      (e) => e.type === 'agent:finished' && (e as { agentId?: string }).agentId?.startsWith('worker-'),
    )
    expect(workerFinished.length).toBeGreaterThanOrEqual(1)
  })

  it('cleans up backgroundTasks entries after completion (success case)', async () => {
    // A fast synchronous runner: the background task completes almost immediately.
    class FastBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'fast', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('done')
        return new AIMessage('done')
      }
    }
    const session = makeRunnerSession('s-clean', new FastBgRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('test cleanup', (m) => events.push(m))

    // Wait for any remaining background tasks
    await Promise.allSettled(session.backgroundTasks.values())

    expect(session.backgroundTasks.size).toBe(0)
    expect(session.listBackgroundTasks()).toEqual([])
  })

  it('injects a synthetic AIMessage when the background task completes', async () => {
    class FastBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'research', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('bg result')
        return new AIMessage('bg result')
      }
    }
    const session = makeRunnerSession('s-inject', new FastBgRunner())
    await collect(session, 'do background research')
    await Promise.allSettled(session.backgroundTasks.values())

    const aiMessages = (session as unknown as { messages: BaseMessage[] }).messages.filter((m) => m instanceof AIMessage)
    expect(aiMessages.some((m) => m.content === 'bg result')).toBe(true)
  })

  it('persists the synthetic message as a session_message projection', async () => {
    const st = inMemoryStore()
    class FastBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'research', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('persisted result')
        return new AIMessage('persisted result')
      }
    }
    const session = makeRunnerSessionWithStore('s-persist', new FastBgRunner(), st)
    await collect(session, 'do background research')
    await Promise.allSettled(session.backgroundTasks.values())

    const rows = loadProjection(st.getDb(), 's-persist')
    const assistantContents = rows
      .filter((r) => r.data.role === 'assistant' && !('kind' in r.data))
      .map((r) => (r.data as { role: 'assistant'; content: string }).content)
    expect(assistantContents).toContain('persisted result')
  })

  it('sends agent:notification when the background task completes', async () => {
    class FastBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'research', mode: 'background' }, id: 'c1', type: 'tool_call' }] })
        }
        opts.onText?.('notified result')
        return new AIMessage('notified result')
      }
    }
    const session = makeRunnerSession('s-notify', new FastBgRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('do background research', (m) => events.push(m))
    await Promise.allSettled(session.backgroundTasks.values())

    const notification = events.find((e) => e.type === 'agent:notification')
    expect(notification).toBeTruthy()
    expect((notification as { status?: string }).status).toBe('completed')
    expect((notification as { result?: string }).result).toBe('notified result')
  })

  it('runBackgroundSubagent can be invoked directly and persists a synthetic message', async () => {
    const st = inMemoryStore()
    class DirectRunner implements ModelRunner {
      async run(): Promise<AIMessage> { return new AIMessage('direct bg') }
    }
    const session = makeRunnerSessionWithStore('s-direct', new DirectRunner(), st)
    const events: ServerMessage[] = []
    const ac = new AbortController()
    await session.runBackgroundSubagent('direct-1', 'direct task', ac.signal, (m) => events.push(m))

    const notification = events.find((e) => e.type === 'agent:notification')
    expect(notification).toBeTruthy()
    expect((notification as { result?: string }).result).toBe('direct bg')

    const rows = loadProjection(st.getDb(), 's-direct')
    const assistantContents = rows
      .filter((r) => r.data.role === 'assistant' && !('kind' in r.data))
      .map((r) => (r.data as { role: 'assistant'; content: string }).content)
    expect(assistantContents).toContain('direct bg')
  })
})
