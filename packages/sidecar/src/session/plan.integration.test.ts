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
      // Planner call: stream 'plan' deltas and return AIMessage with write_todos tool_call
      opts.onText('plan')
      return new AIMessage({
        content: 'plan',
        tool_calls: [
          {
            name: 'write_todos',
            args: { todos: [{ content: 'step 1', status: 'pending' }, { content: 'step 2', status: 'pending' }] },
            id: 'plan-1',
            type: 'tool_call' as const,
          },
        ],
      })
    }
    // Execution call
    this.executed = true
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

    // Verify plan:delta events streamed with 'plan' content
    const deltaEvents = events.filter((e) => e.type === 'plan:delta')
    expect(deltaEvents.length).toBeGreaterThan(0)
    expect(deltaEvents.some((e) => (e as { delta: string }).delta.includes('plan'))).toBe(true)

    // Verify plan:published with 2 PlanItems
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

    // Approve the plan
    const approveEvents: ServerMessage[] = []
    await session.handlePlanResponse('approve', (m) => approveEvents.push(m))

    // Verify execution runner was invoked
    expect(runner.executed).toBe(true)
    expect(runner.callCount).toBeGreaterThanOrEqual(2)

    // Verify plan file was persisted to .hip/plans/<sessionId>.json
    const planFile = join(cwd, '.hip', 'plans', 's-plan-lifecycle.json')
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
  })

  // ──────────────────────────────────────────────────────────────────────────────
  // Test 2: Plan rejection stops execution and writes no plan file
  // ──────────────────────────────────────────────────────────────────────────────

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
})
