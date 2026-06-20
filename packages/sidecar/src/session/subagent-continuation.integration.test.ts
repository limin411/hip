import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'
import { SessionStore } from '../persistence/store.js'
import { openDatabase } from '../persistence/open.js'

// ── Test infrastructure ────────────────────────────────────────────────────────

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'hip-subagent-cont-int-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Create an in-memory SessionStore with a pre-seeded session row. */
function inMemoryStore(): SessionStore {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

/** Ensure a session row exists so FK constraints on messages are satisfied. */
function ensureSession(store: SessionStore, id: string): void {
  const now = Date.now()
  store.insertSession({
    id,
    title: id,
    config: '{}',
    createdAt: now,
    updatedAt: now,
  })
}

/** Create a Session with an injected mock runner and optional store. */
function makeSession(
  id: string,
  runner: ModelRunner,
  store?: SessionStore,
): Session {
  const config: SessionConfig = {
    llmProvider: 'deepseek',
    model: 'deepseek-chat',
    tools: [],
    cwd,
    permissionMode: 'edit',
  }
  if (store) ensureSession(store, id)
  return new Session(id, config, undefined, store, undefined, undefined, runner)
}

/** True when the message list includes a ToolMessage (main-turn continuation). */
function hasToolMessages(msgs: BaseMessage[]): boolean {
  return msgs.some((m) => m instanceof ToolMessage)
}

/** Collect events until message:complete or error. */
async function collect(
  session: Session,
  text: string,
): Promise<ServerMessage[]> {
  const out: ServerMessage[] = []
  return new Promise<ServerMessage[]>((resolve) => {
    session
      .sendMessage(text, (m: ServerMessage) => {
        out.push(m)
        if (m.type === 'message:complete' || m.type === 'error') resolve(out)
      })
      .catch(() => resolve(out))
  })
}

/** Event collector for non-awaited send (keeps collecting until collector is called). */
function eventCollector(): {
  events: ServerMessage[]
  push: (m: ServerMessage) => void
  find: (type: string) => ServerMessage | undefined
} {
  const events: ServerMessage[] = []
  return {
    events,
    push: (m) => events.push(m),
    find: (type) => events.find((e) => e.type === type),
  }
}

// ── Model Runners ──────────────────────────────────────────────────────────────

/** Runner that captures the messages array and tool list it receives, then returns 'done'. */
class CapturingRunner implements ModelRunner {
  capturedMessages?: BaseMessage[]
  capturedTools?: string[]

  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.capturedMessages = messages
    this.capturedTools = opts.tools?.map((t) => t.name)
    return new AIMessage('done')
  }
}

/** Runner that delegates to a swappable inner runner. Lets tests change behavior
 *  between phases (e.g., main turn → resume). */
class DelegateRunner implements ModelRunner {
  private inner: ModelRunner

  /** Messages captured from the most recent call. */
  lastMessages: BaseMessage[] = []
  lastTools: string[] | undefined

  constructor(initial: ModelRunner) {
    this.inner = initial
  }

  setDelegate(r: ModelRunner): void {
    this.inner = r
  }

  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.lastMessages = messages
    this.lastTools = opts.tools?.map((t) => t.name)
    return this.inner.run(messages, opts)
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Test 1: Full subagent lifecycle with task_id continuation and background notification
// ────────────────────────────────────────────────────────────────────────────────

describe('subagent continuation integration', () => {
  it('full subagent lifecycle with task_id continuation and background notification', async () => {
    // ── Phase 1: Spawn a background task and verify agent:notification ──

    // Runner phase 1: issues a task tool_call (background) on call 1,
    // produces the background result on call 2 (subagent — no ToolMessages),
    // produces main-turn done on call 3 (has ToolMessages).
    class Phase1Runner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                name: 'task',
                args: { description: 'research X', mode: 'background' },
                id: 'c1',
                type: 'tool_call' as const,
              },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          // Background sub-agent
          opts.onText?.('background result')
          return new AIMessage('background result')
        }
        // Main-turn continuation
        opts.onText?.('main turn done')
        return new AIMessage('main turn done')
      }
    }

    const store = inMemoryStore()
    const delegator = new DelegateRunner(new Phase1Runner())
    const session = makeSession('s-int-cont', delegator, store)
    const events: ServerMessage[] = []
    await session.sendMessage('start background task', (m) => events.push(m))

    // Wait for background tasks to settle
    await Promise.allSettled(session.backgroundTasks.values())

    // Extract the worker taskId from agent:started
    const workerStarted = events.find(
      (e) =>
        e.type === 'agent:started' &&
        (e as { role?: string }).role === 'worker',
    ) as { agentId?: string } | undefined
    expect(workerStarted).toBeTruthy()
    const taskId = workerStarted!.agentId!
    expect(taskId).toMatch(/^worker-\d+$/)

    // Verify agent:notification emitted with completed status
    const notification = events.find((e) => e.type === 'agent:notification')
    expect(notification).toBeTruthy()
    expect((notification as { status?: string }).status).toBe('completed')
    expect((notification as { result?: string }).result).toBe('background result')
    expect((notification as { description?: string }).description).toBe('research X')
    expect((notification as { taskId?: string }).taskId).toBe(taskId)

    // ── Phase 2: Pre-populate store with prior messages, then resume ──

    // Pre-populate the store with messages for taskId (simulating prior subagent turns)
    ensureSession(store, taskId)
    const ts = Date.now()
    store.insertMessage({
      id: `msg-${taskId}-1`,
      sessionId: taskId,
      role: 'user',
      agentId: null,
      content: 'research X',
      timestamp: ts,
    })
    store.insertMessage({
      id: `msg-${taskId}-2`,
      sessionId: taskId,
      role: 'assistant',
      agentId: taskId,
      content: 'background result',
      timestamp: ts + 1,
    })

    // Swap delegate to CapturingRunner for the resume phase
    const capturing = new CapturingRunner()
    delegator.setDelegate(capturing)

    // Resume the subagent
    const resumeEvents: ServerMessage[] = []
    await session.resumeSubagent(taskId, 'continue research', (m) =>
      resumeEvents.push(m),
    )

    // Verify the subagent received prior context
    expect(capturing.capturedMessages).toBeDefined()
    const resumedMsgs = capturing.capturedMessages!
    expect(resumedMsgs.length).toBeGreaterThanOrEqual(2)

    // The first message should be the prior user message "research X"
    const firstMsg = resumedMsgs[0]
    expect(firstMsg).toBeInstanceOf(HumanMessage)
    expect((firstMsg as HumanMessage).content).toBe('research X')

    // The second should be the prior assistant response "background result"
    const secondMsg = resumedMsgs[1]
    expect(secondMsg).toBeInstanceOf(AIMessage)
    expect((secondMsg as AIMessage).content).toBe('background result')

    // The last message should be the new user message "continue research"
    const lastMsg = resumedMsgs[resumedMsgs.length - 1]
    expect(lastMsg).toBeInstanceOf(HumanMessage)
    expect((lastMsg as HumanMessage).content).toBe('continue research')

    // Verify resume emitted message:complete
    const resumedComplete = resumeEvents.find(
      (e) => e.type === 'message:complete',
    )
    expect(resumedComplete).toBeTruthy()
  })

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 2: Worker profile denies write_todos for subagent
  // ──────────────────────────────────────────────────────────────────────────────

  it("worker profile denies write_todos for subagent", async () => {
    const capturing = new CapturingRunner()
    const session = makeSession('s-int-worker', capturing)
    session.setAgentProfile('worker')
    await collect(session, 'hello')

    // Worker profile blocks write_todos
    expect(capturing.capturedTools).toBeDefined()
    expect(capturing.capturedTools!).not.toContain('write_todos')

    // Worker profile allows write tools
    expect(capturing.capturedTools!).toContain('write_file')
    expect(capturing.capturedTools!).toContain('read_file')
  })

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 3: Cancel mid-subagent properly cleans up
  // ──────────────────────────────────────────────────────────────────────────────

  it('cancel mid-subagent properly cleans up', async () => {
    // Runner that issues a foreground task then hangs on the subagent call
    // until aborted by the parent session's cancel().
    class CancelRunner implements ModelRunner {
      private call = 0
      async run(_msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          // Main agent: issue a foreground task tool_call
          return new AIMessage({
            content: '',
            tool_calls: [
              {
                name: 'task',
                args: { description: 'long foreground work', mode: 'foreground' },
                id: 'c1',
                type: 'tool_call' as const,
              },
            ],
          })
        }
        // Call 2: foreground subagent — hang until signal fires
        if (this.call === 2) {
          return new Promise<AIMessage>((_resolve, reject) => {
            const abortHandler = (): void => {
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            }
            if (opts.signal?.aborted) {
              abortHandler()
              return
            }
            opts.signal?.addEventListener('abort', abortHandler, { once: true })
          })
        }
        // Call 3+: main agent continuation after subagent abort —
        // return a clean completion so the turn can finalise.
        opts.onText?.('subagent aborted, continuing')
        return new AIMessage('subagent aborted, continuing')
      }
    }

    const runner = new CancelRunner()
    const session = makeSession('s-int-cancel', runner)
    const coll = eventCollector()

    // Start sendMessage without awaiting — the foreground subagent will block
    const sendPromise = session.sendMessage('do long foreground work', coll.push)

    // Give the subagent graph time to start (call 2)
    await new Promise((r) => setTimeout(r, 200))

    // Cancel the parent session — aborts the shared AbortController
    session.cancel()

    // The sendMessage promise should settle (resolve or reject) without hanging
    await sendPromise

    // After cancel the session must be usable for another turn
    const secondColl = eventCollector()
    await session.sendMessage('test after cancel', secondColl.push)

    const secondComplete = secondColl.find('message:complete')
    expect(secondComplete).toBeTruthy()
  }, 15_000)
})
