import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'hip-bg-subagent-'))
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function makeStore(): SessionStore {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

/** Background sub-agent calls are detected by absence of ToolMessages in the message list. */
function hasToolMessages(msgs: BaseMessage[]): boolean {
  return msgs.some((m) => m instanceof ToolMessage)
}

function backgroundRunner(result: string): ModelRunner {
  return {
    async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      if (!hasToolMessages(msgs)) {
        opts.onText(result)
        return new AIMessage(result)
      }
      opts.onText('main')
      return new AIMessage('main')
    },
  }
}

function injectSession(manager: SessionManager, id: string, session: Session): void {
  // TypeScript `private` is compile-time only; tests may replace the in-memory session.
  ;(manager as unknown as { sessions: Map<string, Session> }).sessions.set(id, session)
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describe('subagent:background dispatch integration', () => {
  it('dispatches a background subagent and emits lifecycle events', async () => {
    const sessionId = 's-bg-dispatch-1'
    const taskId = 'task-1'
    const store = makeStore()
    store.insertSession({
      id: sessionId,
      title: 'test',
      config: JSON.stringify({ llmProvider: 'deepseek', model: 'mock', tools: [], cwd }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const session = new Session(
      sessionId,
      { llmProvider: 'deepseek', model: 'mock', tools: [], cwd },
      undefined,
      store,
      undefined,
      undefined,
      backgroundRunner('background result'),
    )

    const manager = new SessionManager(store)
    injectSession(manager, sessionId, session)

    const events: ServerMessage[] = []
    const send = (m: ServerMessage) => events.push(m)

    await manager.handleAsync(
      { type: 'subagent:background', sessionId, taskId, description: 'do work in background' },
      send,
    )

    await waitFor(
      () =>
        events.some(
          (e) =>
            e.type === 'agent:finished' &&
            (e as { agentId?: string }).agentId === taskId,
        ),
      2000,
    )

    const started = events.find(
      (e) => e.type === 'agent:started' &&
        (e as { agentId?: string; taskId?: string }).agentId === taskId &&
        (e as { agentId?: string; taskId?: string }).taskId === taskId,
    )
    expect(started).toBeTruthy()

    const notification = events.find(
      (e) => e.type === 'agent:notification' &&
        (e as { taskId?: string }).taskId === taskId,
    )
    expect(notification).toBeTruthy()
    expect((notification as { status?: string; result?: string }).status).toBe('completed')
    expect((notification as { status?: string; result?: string }).result).toBe('background result')

    const finished = events.find(
      (e) => e.type === 'agent:finished' &&
        (e as { agentId?: string }).agentId === taskId,
    )
    expect(finished).toBeTruthy()
  })

  it('returns an error notification when the background subagent fails', async () => {
    const sessionId = 's-bg-dispatch-2'
    const taskId = 'task-2'
    const store = makeStore()
    store.insertSession({
      id: sessionId,
      title: 'test',
      config: JSON.stringify({ llmProvider: 'deepseek', model: 'mock', tools: [], cwd }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const failingRunner: ModelRunner = {
      async run(msgs: BaseMessage[], _opts: ModelRunOptions): Promise<AIMessage> {
        if (!hasToolMessages(msgs)) {
          throw new Error('simulated background failure')
        }
        return new AIMessage('main')
      },
    }

    const session = new Session(
      sessionId,
      { llmProvider: 'deepseek', model: 'mock', tools: [], cwd },
      undefined,
      store,
      undefined,
      undefined,
      failingRunner,
    )

    const manager = new SessionManager(store)
    injectSession(manager, sessionId, session)

    const events: ServerMessage[] = []
    const send = (m: ServerMessage) => events.push(m)

    await manager.handleAsync(
      { type: 'subagent:background', sessionId, taskId, description: 'failing task' },
      send,
    )

    await waitFor(
      () =>
        events.some(
          (e) =>
            e.type === 'agent:finished' &&
            (e as { agentId?: string }).agentId === taskId,
        ),
      2000,
    )

    const notification = events.find(
      (e) => e.type === 'agent:notification' &&
        (e as { taskId?: string }).taskId === taskId,
    )
    expect(notification).toBeTruthy()
    expect((notification as { status?: string; error?: string }).status).toBe('failed')
    expect((notification as { status?: string; error?: string }).error).toContain('simulated background failure')
  })
})
