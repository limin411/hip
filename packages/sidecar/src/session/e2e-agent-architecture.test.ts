import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'
import { SessionStore } from '../persistence/store.js'
import { openDatabase } from '../persistence/open.js'
import { mcpManager } from './mcp/manager.js'

// ── Smoke Runner ────────────────────────────────────────────────────────────────

class SmokeRunner implements ModelRunner {
  private call = 0
  /** Captured system prompts from each runner invocation for assertion. */
  readonly systemPrompts: string[] = []

  async run(msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.call += 1
    const callN = this.call

    // Record system prompt content for later verification
    const sysMsg = msgs.find((m) => m.getType() === 'system')
    if (sysMsg) {
      this.systemPrompts.push(
        typeof sysMsg.content === 'string'
          ? sysMsg.content
          : JSON.stringify(sysMsg.content),
      )
    }

    // Check for write_todos ToolMessage (written by tools node executing write_todos)
    const hasWriteTodosTm = msgs.some(
      (m) => m instanceof ToolMessage && m.name === 'write_todos',
    )

    // Check for task ToolMessage (the main-turn result of spawning a background subagent)
    const hasTaskTm = msgs.some(
      (m) => m instanceof ToolMessage && m.name === 'task',
    )

    // Check if this is likely a subagent call: no ToolMessages present in the
    // graph state (subagents start fresh with [SystemMessage, HumanMessage]).
    const hasToolMsgs = msgs.some((m) => m instanceof ToolMessage)

    // ── Call sequencing ──────────────────────────────────────────────────────

    if (callN === 1) {
      // Plan profile: EnterPlanMode → write_todos → ExitPlanMode (new tool-based flow)
      opts.onText('planning')
      return new AIMessage({
        content: 'planning',
        tool_calls: [
          {
            name: 'EnterPlanMode',
            args: {},
            id: 'plan-enter',
            type: 'tool_call' as const,
          },
          {
            name: 'write_todos',
            args: {
              todos: [
                { content: 'step 1', status: 'pending' },
                { content: 'step 2', status: 'pending' },
              ],
            },
            id: 'plan-1',
            type: 'tool_call' as const,
          },
          {
            name: 'ExitPlanMode',
            args: {},
            id: 'plan-exit',
            type: 'tool_call' as const,
          },
        ],
      })
    }

    if (callN === 2) {
      // After plan approval: resume turn returns text (no tool_calls — the
      // approved-plan continuation is still bound to the plan profile).
      return new AIMessage('plan noted')
    }

    if (callN === 3) {
      // Supervisor agent: spawn a background subagent via the `task` tool.
      // The history still contains the write_todos ToolMessage from the plan
      // phase, so check call number before the ToolMessage heuristics.
      return new AIMessage({
        content: '',
        tool_calls: [
          {
            name: 'task',
            args: { description: 'background subagent', mode: 'background' },
            id: 'task-1',
            type: 'tool_call' as const,
          },
        ],
      })
    }

    // After call 3, the tools node executes the task tool. The main-turn
    // continuation receives a ToolMessage for the task result; the background
    // subagent starts with a fresh graph (no ToolMessages).  Use message
    // composition to disambiguate regardless of which async call runs first.
    if (hasTaskTm) {
      // Main turn continuation — has the task ToolMessage
      opts.onText('all done')
      return new AIMessage('all done')
    }

    if (!hasToolMsgs && callN >= 4) {
      // Background subagent — no ToolMessages in state
      opts.onText('subagent done')
      return new AIMessage('subagent done')
    }

    if (hasWriteTodosTm) {
      // Tools node executed write_todos → confirm (defensive fallback for
      // any plan-phase continuation that does not match the numbered calls).
      return new AIMessage('todos recorded')
    }

    // Fallback (should never be reached)
    return new AIMessage('fallback')
  }
}

// ── Test infrastructure ─────────────────────────────────────────────────────────

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'hip-e2e-arc-'))
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

/** Create a Session with an injected mock runner, optional store, and supervisor as default. */
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
  const session = new Session(
    id,
    config,
    undefined,
    store,
    undefined,
    undefined,
    runner,
  )
  // Default active profile is already 'supervisor' (AgentProfileManager default)
  return session
}

// ── Full smoke test ─────────────────────────────────────────────────────────────

describe('agent architecture end-to-end smoke', () => {
  it('full smoke test across all waves', async () => {
    // Mock mcpManager to return empty results (no real MCP servers)
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const store = inMemoryStore()
    const runner = new SmokeRunner()
    const sessionId = 's-e2e-arc'
    const session = makeSession(sessionId, runner, store)

    // ── Phase 1: Plan profile generates a plan ───────────────────────────────
    session.setAgentProfile('plan')

    const planEvents: ServerMessage[] = []
    await session.sendMessage('plan a feature', (m) => planEvents.push(m))

    // Verify plan:published with 2 PlanItems (tool-based flow: EnterPlanMode → write_todos → ExitPlanMode)
    const publishedEvent = planEvents.find((e) => e.type === 'plan:published')
    expect(publishedEvent).toBeTruthy()
    const plan = (publishedEvent as { plan: Array<{ content: string; status: string }> })
      .plan
    expect(Array.isArray(plan)).toBe(true)
    expect(plan.length).toBe(2)
    expect(plan[0].content).toBe('step 1')
    expect(plan[0].status).toBe('pending')
    expect(plan[1].content).toBe('step 2')
    expect(plan[1].status).toBe('pending')

    // Verify agent:interrupt with plan review question
    const interruptEvent = planEvents.find((e) => e.type === 'agent:interrupt')
    expect(interruptEvent).toBeTruthy()
    const question = (interruptEvent as { question: string }).question
    expect(question.toLowerCase()).toContain('plan')

    // ── Phase 2: Approve plan → persist + resume agent ───────────────────────
    const approveEvents: ServerMessage[] = []
    await session.handlePlanResponse('approve', (m) => approveEvents.push(m))

    // Verify plan file was persisted to .hip/plans/<sessionId>.json
    const planFile = join(cwd, '.hip', 'plans', `${sessionId}.json`)
    expect(existsSync(planFile)).toBe(true)
    const planContent = JSON.parse(readFileSync(planFile, 'utf8')) as {
      sessionId: string
      plan: Array<{ content: string; status: string }>
      approvedAt: number
    }
    expect(planContent.sessionId).toBe(sessionId)
    expect(Array.isArray(planContent.plan)).toBe(true)
    expect(planContent.plan.length).toBe(2)
    expect(typeof planContent.approvedAt).toBe('number')
    expect(planContent.approvedAt).toBeGreaterThan(0)

    // ── Phase 3: Switch to supervisor → spawn subagent → verify pipeline ─────
    session.setAgentProfile('supervisor')

    const execEvents: ServerMessage[] = []
    await session.sendMessage('execute it', (m) => execEvents.push(m))

    // Wait for background subagent to finish
    await Promise.allSettled(session.backgroundTasks.values())

    // Verify agent:started for the worker (background subagent)
    const workerStarted = execEvents.find(
      (e) =>
        e.type === 'agent:started' &&
        (e as { role?: string }).role === 'worker',
    )
    expect(workerStarted).toBeTruthy()
    expect((workerStarted as { agentId?: string }).agentId).toMatch(
      /^worker-\d+$/,
    )

    // Verify agent:notification emitted after background subagent completes
    const notification = execEvents.find(
      (e) => e.type === 'agent:notification',
    )
    expect(notification).toBeTruthy()
    expect((notification as { status?: string }).status).toBe('completed')
    expect((notification as { description?: string }).description).toBe(
      'background subagent',
    )
    expect((notification as { result?: string }).result).toBe('subagent done')

    // Verify final message:complete with 'all done' content
    const completeMsg = execEvents.find((e) => e.type === 'message:complete')
    expect(completeMsg).toBeTruthy()
    const completeContent = (
      completeMsg as { message: { content: string } }
    ).message.content
    expect(completeContent).toContain('all done')

    // Verify background tasks cleaned up
    expect(session.backgroundTasks.size).toBe(0)
    expect(session.listBackgroundTasks()).toEqual([])

    // ── Cross-cutting assertions ─────────────────────────────────────────────

    // Verify hook fires: register a TurnComplete hook and confirm it was called
    let hookFired = false
    session.registerHook({
      event: 'TurnComplete',
      handler: async () => {
        hookFired = true
        return { kind: 'allow' }
      },
    })

    const hookEvents: ServerMessage[] = []
    await session.sendMessage('final check', (m) => hookEvents.push(m))
    expect(hookFired).toBe(true)
    expect(hookEvents.some((e) => e.type === 'message:complete')).toBe(true)
  })
})
