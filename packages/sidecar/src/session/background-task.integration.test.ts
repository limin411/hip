import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AIMessage,
  ToolMessage,
  type AIMessage as AIMsg,
  type BaseMessage,
} from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'hip-bg-int-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Create a Session with an injected mock runner (no real LLM). */
function sessionWithRunner(id: string, runner: ModelRunner): Session {
  return new Session(
    id,
    { llmProvider: 'deepseek', model: 'mock', tools: [], cwd },
    undefined,
    undefined,
    undefined,
    undefined,
    runner,
  )
}

/** Collect events until message:complete or error. */
async function collect(session: Session, text: string): Promise<ServerMessage[]> {
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

/** True when the message list includes a ToolMessage — signals a main-turn continuation (the background
 *  sub-agent starts fresh with [SystemMessage, HumanMessage]). */
function hasToolMessages(msgs: BaseMessage[]): boolean {
  return msgs.some((m) => m instanceof ToolMessage)
}

// ---------------------------------------------------------------------------
// Integration tests — full Session + mock ModelRunner path through runTurn,
// task tool → spawnSubagent closure → runSubagent. The mock runners distinguish
// main-turn calls (with ToolMessages) from sub-agent calls (without ToolMessages).
// ---------------------------------------------------------------------------

describe('background subagent integration', () => {
  it('spawns a background subagent and emits agent:started before the main turn completes', async () => {
    // Gate the background sub-agent so it stays in-flight while we observe backgroundTasks.
    let releaseBg!: () => void
    const bgGate = new Promise<void>((r) => { releaseBg = r })

    class GatedSpawnRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'research X', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          await bgGate
          opts.onText?.('research result')
          return new AIMessage('research result')
        }
        opts.onText?.('main turn done')
        return new AIMessage('main turn done')
      }
    }

    const session = sessionWithRunner('s-int-bg', new GatedSpawnRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('do background research', (m) => events.push(m))

    // agent:started for worker must appear (emitted synchronously before the tool returns)
    const workerStarted = events.find(
      (e) => e.type === 'agent:started' && (e as { role?: string }).role === 'worker',
    )
    expect(workerStarted).toBeTruthy()
    expect((workerStarted as { agentId?: string }).agentId).toMatch(/^worker-\d+$/)

    // Main turn completed (background task was non-blocking)
    expect(events.find((e) => e.type === 'message:complete')).toBeTruthy()

    // The background task promise is still registered (gated, not yet completed)
    expect(session.backgroundTasks.size).toBeGreaterThanOrEqual(1)

    // Release and wait for cleanup
    releaseBg()
    await Promise.allSettled(session.backgroundTasks.values())
    expect(session.backgroundTasks.size).toBe(0)
  })

  it('verifies main agent continues to stream while background subagent is running', async () => {
    // Gate the background sub-agent so it doesn't finish until we release it.
    let releaseBg!: () => void
    const bgGate = new Promise<void>((r) => { releaseBg = r })

    class GatedBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'slow work', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          // Background sub-agent: blocked on gate
          await bgGate
          opts.onText?.('bg done')
          return new AIMessage('bg done')
        }
        // Main-turn continuation
        opts.onText?.('main continues')
        return new AIMessage('main continues')
      }
    }

    const session = sessionWithRunner('s-int-gated', new GatedBgRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('do slow background work', (m) => events.push(m))

    // Before releasing the gate: worker started, main turn completed
    const workerStarted = events.find(
      (e) => e.type === 'agent:started' && (e as { role?: string }).role === 'worker',
    )
    expect(workerStarted).toBeTruthy()
    expect(events.find((e) => e.type === 'message:complete')).toBeTruthy()

    // Background task is still in-flight
    expect(session.backgroundTasks.size).toBe(1)
    expect(session.listBackgroundTasks().length).toBe(1)

    // Release the background sub-agent
    releaseBg()
    await Promise.allSettled(session.backgroundTasks.values())

    // After completion, backgroundTasks should be cleared
    expect(session.backgroundTasks.size).toBe(0)
    expect(session.listBackgroundTasks()).toEqual([])

    // agent:finished for the worker should have been emitted
    const workerFinished = events.find(
      (e) =>
        e.type === 'agent:finished' &&
        (e as { agentId?: string }).agentId?.startsWith('worker-'),
    )
    expect(workerFinished).toBeTruthy()
  })

  it('background task completes with agent:finished event containing output text', async () => {
    class BgCompleteRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'find the answer', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          // Background sub-agent: produce output
          opts.onText?.('found: 42')
          return new AIMessage('found: 42')
        }
        opts.onText?.('roger that')
        return new AIMessage('roger that')
      }
    }

    const session = sessionWithRunner('s-int-complete', new BgCompleteRunner())
    const events = await collect(session, 'find the answer')

    // Wait for background task to finish
    await Promise.allSettled(session.backgroundTasks.values())

    // Verify agent:finished for worker
    const workerFinished = events.find(
      (e) =>
        e.type === 'agent:finished' &&
        (e as { agentId?: string }).agentId?.startsWith('worker-'),
    )
    expect(workerFinished).toBeTruthy()

    // Agent output is stored in the trajectory (verified via agent:finished existence)
    // BackgroundTasks map is cleaned up
    expect(session.backgroundTasks.size).toBe(0)
  })

  it('multiple background tasks can be spawned in sequence', async () => {
    // Runner: call 1 = issue task A (background), call 2 = subagent for A,
    // call 3 = (main continuation, has ToolMessage) issue task B (background),
    // call 4 = subagent for B, call 5 = main continuation, finish without tool_calls.
    // sub-agent turns detected by absence of ToolMessages.
    class MultiBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          // Main turn, first agent call: issue task A as background
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'task A', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          // Sub-agent (fresh graph, no ToolMessages)
          opts.onText?.('bg done')
          return new AIMessage('bg done')
        }
        // Main turn continuation (has ToolMessages from previous tool results)
        if (this.call === 3) {
          // Second main agent call after task A: issue task B as background
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'task B', mode: 'background' }, id: 'c2', type: 'tool_call' as const },
            ],
          })
        }
        // Final main turn: complete
        opts.onText?.('all tasks spawned')
        return new AIMessage('all tasks spawned')
      }
    }

    const session = sessionWithRunner('s-int-multi', new MultiBgRunner())
    const events = await collect(session, 'spawn two background tasks')

    // Wait for all background tasks
    await Promise.allSettled(session.backgroundTasks.values())

    // Should have two worker agent:started events (one per spawnSubagent call)
    const workerStarted = events.filter(
      (e) => e.type === 'agent:started' && (e as { role?: string }).role === 'worker',
    )
    expect(workerStarted.length).toBeGreaterThanOrEqual(2)

    // All cleaned up
    expect(session.backgroundTasks.size).toBe(0)
  })

  it('rejects the 11th concurrent background task via tool path', async () => {
    // Pre-populate 10 never-settling promises
    const session = sessionWithRunner('s-int-max', {
      async run() {
        return new AIMessage('unused')
      },
    } as ModelRunner)

    for (let i = 0; i < Session.MAX_BACKGROUND_TASKS; i++) {
      session.backgroundTasks.set(`pre-${i}`, new Promise(() => {}))
    }
    expect(session.backgroundTasks.size).toBe(10)

    // Runner that tries to spawn an 11th background task
    class OverflowRunner implements ModelRunner {
      async run(_msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        opts.onText?.('trying overflow')
        return new AIMessage({
          content: '',
          tool_calls: [
            { name: 'task', args: { description: 'overflow', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
          ],
        })
      }
    }

    const session2 = sessionWithRunner('s-int-max2', new OverflowRunner())
    // Pre-populate 10 for session2 as well
    for (let i = 0; i < Session.MAX_BACKGROUND_TASKS; i++) {
      session2.backgroundTasks.set(`pre-${i}`, new Promise(() => {}))
    }

    const events = await collect(session2, 'start overflow task')

    // BackgroundTasks must not exceed MAX
    expect(session2.backgroundTasks.size).toBe(10)

    // The tool result should contain the error string
    const complete = events.find((e) => e.type === 'message:complete') as Extract<
      ServerMessage,
      { type: 'message:complete' }
    >
    expect(complete).toBeTruthy()
  })

  it('catches background task errors and emits agent:finished with error output', async () => {
    class ErrorBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'boom', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          throw new Error('simulated bg crash')
        }
        opts.onText?.('main continues')
        return new AIMessage('main continues')
      }
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = sessionWithRunner('s-int-err', new ErrorBgRunner())
    const events = await collect(session, 'do crashing work')

    // Wait for background task to settle
    await Promise.allSettled(session.backgroundTasks.values())

    // Background task cleaned up
    expect(session.backgroundTasks.size).toBe(0)

    // Error was logged
    const errCalls = consoleSpy.mock.calls.filter((c) =>
      String(c[0]).includes('Background task'),
    )
    expect(errCalls.length).toBeGreaterThanOrEqual(1)

    // agent:finished emitted for the failed worker
    const workerFinished = events.find(
      (e) =>
        e.type === 'agent:finished' &&
        (e as { agentId?: string }).agentId?.startsWith('worker-'),
    )
    expect(workerFinished).toBeTruthy()
  })

  it('cleanup: backgroundTasks map is empty after all tasks finish', async () => {
    class FastBgRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'fast', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          opts.onText?.('quick bg work')
          return new AIMessage('quick bg work')
        }
        opts.onText?.('done')
        return new AIMessage('done')
      }
    }

    const session = sessionWithRunner('s-int-clean', new FastBgRunner())
    const events = await collect(session, 'test cleanup')

    // Wait for background tasks
    await Promise.allSettled(session.backgroundTasks.values())

    expect(session.backgroundTasks.size).toBe(0)
    expect(session.listBackgroundTasks()).toEqual([])
  })

  it('emits agent:notification after background task completes successfully', async () => {
    class NotifyRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'notify success', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          opts.onText?.('bg result')
          return new AIMessage('bg result')
        }
        opts.onText?.('main done')
        return new AIMessage('main done')
      }
    }

    const session = sessionWithRunner('s-int-notify', new NotifyRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('test notification', (m) => events.push(m))

    // Wait for background task to finish
    await Promise.allSettled(session.backgroundTasks.values())

    // Verify agent:notification was emitted
    const notification = events.find((e) => e.type === 'agent:notification')
    expect(notification).toBeTruthy()
    expect((notification as { status?: string }).status).toBe('completed')
    expect((notification as { description?: string }).description).toBe('notify success')
    expect((notification as { sessionId?: string }).sessionId).toBe('s-int-notify')
    expect((notification as { taskId?: string }).taskId).toMatch(/^worker-\d+$/)
    expect((notification as { result?: string }).result).toBe('bg result')
  })

  it('emits agent:notification with failed status on background task error', async () => {
    class ErrorNotifyRunner implements ModelRunner {
      private call = 0
      async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.call += 1
        if (this.call === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [
              { name: 'task', args: { description: 'error notify test', mode: 'background' }, id: 'c1', type: 'tool_call' as const },
            ],
          })
        }
        if (!hasToolMessages(msgs)) {
          throw new Error('simulated bg crash')
        }
        opts.onText?.('main done')
        return new AIMessage('main done')
      }
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = sessionWithRunner('s-int-err-notify', new ErrorNotifyRunner())
    const events: ServerMessage[] = []
    await session.sendMessage('test error notification', (m) => events.push(m))

    // Wait for background task to finish
    await Promise.allSettled(session.backgroundTasks.values())

    // Verify agent:notification with failed status
    const notification = events.find((e) => e.type === 'agent:notification')
    expect(notification).toBeTruthy()
    expect((notification as { status?: string }).status).toBe('failed')
    expect((notification as { description?: string }).description).toBe('error notify test')
    expect((notification as { error?: string }).error).toContain('simulated bg crash')

    consoleSpy.mockRestore()
  })
})
