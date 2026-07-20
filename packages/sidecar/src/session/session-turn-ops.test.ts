/**
 * KD-PA-1: message:resume while planStatus===ready → amend / empty-error (never soft-approve).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import { resume } from './session-turn-ops.js'
import type { SessionTurnHost } from './session-turn-runner.js'

vi.mock('./session-turn-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./session-turn-runner.js')>()
  return {
    ...actual,
    runTurn: vi.fn(async () => ''),
    runManagedAgentTurn: vi.fn(async () => ''),
  }
})

import { runTurn } from './session-turn-runner.js'

function makeHost(overrides: Partial<{
  planStatus: 'ready' | 'generating' | 'none'
  planModeActive: boolean
}> = {}): SessionTurnHost & {
  planMode: { isActive: boolean; exit: () => void; cancel: () => void }
  clearPlanApprovalPause: () => void
} {
  const planStatus = overrides.planStatus ?? 'ready'
  return {
    id: 's-ops',
    _config: { llmProvider: 'deepseek', model: 'm', tools: [], forcePlan: false },
    orchMode: 'fast',
    pendingWorkflowDef: null,
    messages: [],
    abortController: null,
    resumeAbortController: null,
    running: false,
    awaitingResume: true,
    paused: {
      messages: [new HumanMessage('task'), new AIMessage('plan ready')],
      steps: 2,
      planningMode: 'plan',
      planStatus,
      plan: [{ content: 'step 1', status: 'pending' }],
      interruptTurnId: 'turn-1',
    },
    turnSeq: 1,
    planMode: {
      isActive: overrides.planModeActive ?? true,
      exit: vi.fn(),
      cancel: vi.fn(),
    },
    clearPlanApprovalPause: vi.fn(),
    currentModelSupportsImages: () => true,
    store: null,
    emit: vi.fn(),
    scratchRoot: '/tmp',
  } as unknown as SessionTurnHost & {
    planMode: { isActive: boolean; exit: () => void; cancel: () => void }
    clearPlanApprovalPause: () => void
  }
}

describe('resume while planStatus ready (KD-PA-1)', () => {
  beforeEach(() => {
    vi.mocked(runTurn).mockClear()
  })

  it('non-empty resume amends (planningMode plan, planStatus generating) — never soft-approves', async () => {
    const host = makeHost()
    const sent: ServerMessage[] = []
    await resume(host, 'please revise step 2', (m) => sent.push(m))

    expect(host.awaitingResume).toBe(false)
    expect(host.paused).toBeNull()
    expect(host.planMode.exit).not.toHaveBeenCalled()
    expect(sent.some((m) => m.type === 'agent:interrupt:resolved')).toBe(true)
    expect(sent.some((m) => m.type === 'error')).toBe(false)

    expect(runTurn).toHaveBeenCalledTimes(1)
    const base = vi.mocked(runTurn).mock.calls[0]![2] as {
      planningMode: string
      planStatus: string
      steps: number
    }
    expect(base).toMatchObject({
      planningMode: 'plan',
      planStatus: 'generating',
      steps: 2,
    })
  })

  it('empty resume emits PLAN_AWAITING_RESPONSE and leaves pause intact', async () => {
    const host = makeHost()
    const sent: ServerMessage[] = []
    await resume(host, '   ', (m) => sent.push(m))

    expect(host.awaitingResume).toBe(true)
    expect(host.paused?.planStatus).toBe('ready')
    expect(runTurn).not.toHaveBeenCalled()
    expect(sent).toEqual([
      expect.objectContaining({
        type: 'error',
        sessionId: 's-ops',
        code: 'PLAN_AWAITING_RESPONSE',
      }),
    ])
    expect(sent.some((m) => m.type === 'agent:interrupt:resolved')).toBe(false)
  })

  it('non-ready pause continues normal resume (not plan amend matrix)', async () => {
    const host = makeHost({ planStatus: 'none' })
    const sent: ServerMessage[] = []
    await resume(host, 'continue', (m) => sent.push(m))

    expect(runTurn).toHaveBeenCalledTimes(1)
    const base = vi.mocked(runTurn).mock.calls[0]![2] as { planStatus?: string; planningMode?: string }
    expect(base.planStatus).toBe('none')
    expect(sent.some((m) => m.type === 'error' && (m as { code?: string }).code === 'PLAN_AWAITING_RESPONSE')).toBe(
      false,
    )
  })
})
