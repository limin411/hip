import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'
import { SessionStore } from '../persistence/store.js'
import { openDatabase } from '../persistence/open.js'

// ── Test infrastructure ────────────────────────────────────────────────────────

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'hip-plan-int-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
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

/** Create a Session with an injected mock runner, plan profile active, and optional store. */
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
  const session = new Session(id, config, undefined, store, undefined, undefined, runner)
  session.setAgentProfile('plan')
  return session
}

// ── Model Runners ──────────────────────────────────────────────────────────────

class PlanRunner implements ModelRunner {
  callCount = 0
  executed = false

  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.callCount += 1
    if (this.callCount === 1) {
      // Planner call: stream tokens and emit EnterPlanMode → write_todos → ExitPlanMode
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
            args: { todos: [{ content: 'step 1', status: 'pending' }, { content: 'step 2', status: 'pending' }] },
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
    // Execution call (after plan approval)
    this.executed = true
    opts.onText('executing plan')
    return new AIMessage('plan executed')
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// Test 1: Full plan lifecycle with delta streaming, approval, execution, and persistence
// ────────────────────────────────────────────────────────────────────────────────

describe('plan lifecycle integration', () => {
  it('full plan cycle with delta streaming and persistence', async () => {
    const store = inMemoryStore()
    const runner = new PlanRunner()
    const session = makeSession('s-plan-lifecycle', runner, store)

    // Send a message that triggers plan mode (contains "plan" keyword)
    const events: ServerMessage[] = []
    await session.sendMessage('plan something', (m) => events.push(m))

    // Verify plan:published with 2 PlanItems (from the new tool-based flow:
    // EnterPlanMode → write_todos → ExitPlanMode → planPause → awaiting_user)
    const publishedEvent = events.find((e) => e.type === 'plan:published')
    expect(publishedEvent).toBeTruthy()
    const plan = (publishedEvent as { plan: Array<{ content: string; status: string }> }).plan
    expect(Array.isArray(plan)).toBe(true)
    expect(plan.length).toBe(2)
    expect(plan[0].content).toBe('step 1')
    expect(plan[0].status).toBe('pending')
    expect(plan[1].content).toBe('step 2')
    expect(plan[1].status).toBe('pending')

    // Verify agent:interrupt with plan review question
    const interruptEvent = events.find((e) => e.type === 'agent:interrupt')
    expect(interruptEvent).toBeTruthy()
    const question = (interruptEvent as { question: string }).question
    expect(question.toLowerCase()).toContain('plan')
    // Only planStatus=ready should carry plan_approval (not later doom/error pauses).
    const interruptCtx = (interruptEvent as { context?: string }).context
    expect(interruptCtx).toBeTruthy()
    expect(JSON.parse(interruptCtx!).kind).toBe('plan_approval')

    // Approve the plan
    const approveEvents: ServerMessage[] = []
    await session.handlePlanResponse('approve', (m) => approveEvents.push(m))

    // KD-16: every plan:respond path emits plan:respond:result
    const respondResult = approveEvents.find((e) => e.type === 'plan:respond:result') as
      | Extract<ServerMessage, { type: 'plan:respond:result' }>
      | undefined
    expect(respondResult).toMatchObject({ ok: true, action: 'approve', sessionId: 's-plan-lifecycle' })

    // Verify execution runner was invoked
    expect(runner.executed).toBe(true)
    expect(runner.callCount).toBeGreaterThanOrEqual(2)
    // Execution pauses (if any) must not re-tag as plan_approval.
    const execInterrupts = approveEvents.filter((e) => e.type === 'agent:interrupt')
    for (const ev of execInterrupts) {
      const ctx = (ev as { context?: string }).context
      if (ctx) {
        expect(JSON.parse(ctx).kind).not.toBe('plan_approval')
      }
    }

    // Approved plan JSON lives under ~/.hip/plans/ (not project cwd)
    const { approvedPlanJsonPath } = await import('./plan-persistence.js')
    const planFile = approvedPlanJsonPath('s-plan-lifecycle')
    expect(existsSync(planFile)).toBe(true)
    const planContent = JSON.parse(readFileSync(planFile, 'utf8')) as {
      sessionId: string
      plan: Array<{ content: string; status: string }>
      approvedAt: number
    }
    expect(planContent.sessionId).toBe('s-plan-lifecycle')
    expect(Array.isArray(planContent.plan)).toBe(true)
    expect(planContent.plan.length).toBe(2)
    expect(planContent.plan[0].content).toBe('step 1')
    expect(typeof planContent.approvedAt).toBe('number')
    expect(planContent.approvedAt).toBeGreaterThan(0)
    // Worktree must not gain a project-local .hip/plans artifact
    expect(existsSync(join(cwd, '.hip', 'plans', 's-plan-lifecycle.json'))).toBe(false)
  })

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 2: Plan rejection stops execution and writes no plan file
  // ──────────────────────────────────────────────────────────────────────────────

  it('message:resume during plan approval amends (resume_as_amend), does not soft-approve', async () => {
    const store = inMemoryStore()
    // After first plan ready, amend re-enters plan mode → Exit again → pause again.
    class AmendPlanRunner implements ModelRunner {
      callCount = 0
      executed = false
      async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.callCount += 1
        if (this.callCount === 1) {
          opts.onText('here is the plan')
          return new AIMessage({
            content: 'here is the plan',
            tool_calls: [
              { name: 'EnterPlanMode', args: {}, id: 'plan-enter', type: 'tool_call' as const },
              {
                name: 'write_todos',
                args: {
                  todos: [
                    { content: 'step 1', status: 'pending' },
                    { content: 'step 2', status: 'pending' },
                  ],
                },
                id: 'todos-1',
                type: 'tool_call' as const,
              },
              { name: 'ExitPlanMode', args: {}, id: 'plan-exit', type: 'tool_call' as const },
            ],
          })
        }
        // Amend turn: still planning (not approved execute)
        opts.onText('revised plan')
        return new AIMessage({
          content: 'revised plan',
          tool_calls: [
            {
              name: 'write_todos',
              args: {
                todos: [
                  { content: 'step 1 revised', status: 'pending' },
                  { content: 'step 2', status: 'pending' },
                ],
              },
              id: 'todos-2',
              type: 'tool_call' as const,
            },
            { name: 'ExitPlanMode', args: {}, id: 'plan-exit-2', type: 'tool_call' as const },
          ],
        })
      }
    }
    const runner = new AmendPlanRunner()
    const session = makeSession('s-plan-resume', runner, store)
    session.setForcePlan(true)

    const planEvents: ServerMessage[] = []
    await session.sendMessage('plan something', (m) => planEvents.push(m))

    const interrupt = planEvents.find((e) => e.type === 'agent:interrupt') as
      | Extract<ServerMessage, { type: 'agent:interrupt' }>
      | undefined
    expect(interrupt).toBeTruthy()
    expect(JSON.parse(interrupt!.context ?? '{}').kind).toBe('plan_approval')
    expect(session.config.forcePlan).toBeFalsy()

    const resumeEvents: ServerMessage[] = []
    await session.resume('来自 GitHub，用代理 127.0.0.1:7890', (m) => resumeEvents.push(m))

    // Must NOT execute as approved — amend stays in plan mode and re-prompts approval.
    expect(runner.executed).toBe(false)
    expect(runner.callCount).toBeGreaterThanOrEqual(2)
    const resumePlanApprovals = resumeEvents.filter((e) => {
      if (e.type !== 'agent:interrupt') return false
      try {
        return JSON.parse((e as { context?: string }).context ?? '{}').kind === 'plan_approval'
      } catch {
        return false
      }
    })
    expect(resumePlanApprovals.length).toBeGreaterThanOrEqual(1)
    expect(resumeEvents.some((e) => e.type === 'error' && (e as { code?: string }).code === 'PLAN_AWAITING_RESPONSE')).toBe(false)
  })

  it('message:resume with empty content while plan ready returns PLAN_AWAITING_RESPONSE and keeps pause', async () => {
    const runner = new PlanRunner()
    const session = makeSession('s-plan-resume-empty', runner)
    session.setForcePlan(true)

    const planEvents: ServerMessage[] = []
    await session.sendMessage('plan something', (m) => planEvents.push(m))
    expect(planEvents.some((e) => e.type === 'agent:interrupt')).toBe(true)

    const resumeEvents: ServerMessage[] = []
    await session.resume('', (m) => resumeEvents.push(m))

    expect(runner.executed).toBe(false)
    const err = resumeEvents.find((e) => e.type === 'error') as
      | Extract<ServerMessage, { type: 'error' }>
      | undefined
    expect(err).toMatchObject({ type: 'error', code: 'PLAN_AWAITING_RESPONSE' })
    // Pause intact: plan:respond approve still works
    const approveEvents: ServerMessage[] = []
    await session.handlePlanResponse('approve', (m) => approveEvents.push(m))
    expect(approveEvents.some((e) => e.type === 'plan:respond:result' && (e as { ok: boolean }).ok)).toBe(true)
    expect(runner.executed).toBe(true)
  })

  it('plan rejection stops execution', async () => {
    const runner = new PlanRunner()
    const session = makeSession('s-plan-reject', runner)

    // Generate plan
    const events: ServerMessage[] = []
    await session.sendMessage('plan something', (m) => events.push(m))

    // Verify plan was generated and published
    const publishedEvent = events.find((e) => e.type === 'plan:published')
    expect(publishedEvent).toBeTruthy()

    // Reject the plan
    const rejectEvents: ServerMessage[] = []
    await session.handlePlanResponse('reject', (m) => rejectEvents.push(m))

    expect(rejectEvents.some((e) => e.type === 'plan:respond:result' && (e as { ok: boolean }).ok === true)).toBe(true)

    // Verify execution runner was NOT called (only 1 call = planner)
    expect(runner.callCount).toBe(1)
    expect(runner.executed).toBe(false)

    // Verify error event with PLAN_REJECTED code
    const errorEvent = rejectEvents.find((e) => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect((errorEvent as { code: string }).code).toBe('PLAN_REJECTED')

    // Verify no plan file was written
    const planFile = join(cwd, '.hip', 'plans', 's-plan-reject.json')
    expect(existsSync(planFile)).toBe(false)
  })

  it('KD-16: plan:respond when not awaiting emits result ok:false not_awaiting', async () => {
    const runner = new PlanRunner()
    const session = makeSession('s-plan-skip', runner)
    const events: ServerMessage[] = []
    await session.handlePlanResponse('approve', (m) => events.push(m))
    const result = events.find((e) => e.type === 'plan:respond:result') as
      | Extract<ServerMessage, { type: 'plan:respond:result' }>
      | undefined
    expect(result).toMatchObject({
      type: 'plan:respond:result',
      sessionId: 's-plan-skip',
      ok: false,
      action: 'approve',
      reason: 'not_awaiting',
    })
    expect(runner.executed).toBe(false)
  })

  // ──────────────────────────────────────────────────────────────────────────────
  // D4b: ExitPlanMode without write_todos still publishes empty plan for approval
  // ──────────────────────────────────────────────────────────────────────────────

  it('empty plan (ExitPlanMode only) still emits plan:published with plan: [] before interrupt', async () => {
    class EmptyPlanRunner implements ModelRunner {
      callCount = 0
      async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        this.callCount += 1
        if (this.callCount === 1) {
          opts.onText('empty plan')
          return new AIMessage({
            content: 'empty plan',
            tool_calls: [
              {
                name: 'EnterPlanMode',
                args: {},
                id: 'plan-enter',
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
        opts.onText('done')
        return new AIMessage('done')
      }
    }

    const runner = new EmptyPlanRunner()
    const session = makeSession('s-plan-empty', runner)

    const events: ServerMessage[] = []
    await session.sendMessage('plan something', (m) => events.push(m))

    const publishedIdx = events.findIndex((e) => e.type === 'plan:published')
    const interruptIdx = events.findIndex((e) => e.type === 'agent:interrupt')
    expect(publishedIdx).toBeGreaterThanOrEqual(0)
    expect(interruptIdx).toBeGreaterThan(publishedIdx)

    const published = events[publishedIdx] as Extract<ServerMessage, { type: 'plan:published' }>
    expect(published.plan).toEqual([])

    const interrupt = events[interruptIdx] as Extract<ServerMessage, { type: 'agent:interrupt' }>
    const ctx = JSON.parse(interrupt.context ?? '{}') as { kind?: string; plan?: unknown }
    expect(ctx.kind).toBe('plan_approval')
    expect(ctx.plan).toEqual([])
  })
})
