import { describe, it, expect, vi } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import {
  emitPlanApprovalResync,
  readPlanApprovalPause,
  stripPlanApprovalPause,
  withPlanApprovalPause,
  withoutPlanApprovalPause,
  PLAN_APPROVAL_PAUSE_KEY,
} from './plan-approval-resync.js'

describe('plan-approval-resync', () => {
  it('round-trips pause marker on config', () => {
    const marker = {
      turnId: 't1',
      plan: [{ content: 'step', status: 'pending' as const }],
      question: 'Approve?',
    }
    const cfg = withPlanApprovalPause(
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      marker,
    )
    expect(readPlanApprovalPause(cfg)).toEqual(marker)
    const stripped = stripPlanApprovalPause(cfg)
    expect(readPlanApprovalPause(stripped)).toBeNull()
    expect((stripped as unknown as Record<string, unknown>)[PLAN_APPROVAL_PAUSE_KEY]).toBeUndefined()
    expect(withoutPlanApprovalPause(cfg)).toEqual(stripped)
  })

  it('emitPlanApprovalResync sends published then interrupt', () => {
    const sent: ServerMessage[] = []
    emitPlanApprovalResync(
      (m) => sent.push(m),
      's1',
      {
        turnId: 'turn-1',
        plan: [{ content: 'a', status: 'pending' }],
        question: 'Approve this plan?',
      },
    )
    expect(sent.map((m: ServerMessage) => m.type)).toEqual(['plan:published', 'agent:interrupt'])
    expect(sent[0]).toMatchObject({
      type: 'plan:published',
      sessionId: 's1',
      turnId: 'turn-1',
      plan: [{ content: 'a', status: 'pending' }],
    })
    expect(sent[1]).toMatchObject({
      type: 'agent:interrupt',
      sessionId: 's1',
      turnId: 'turn-1',
      agentId: 'supervisor',
      question: 'Approve this plan?',
    })
    const ctx = JSON.parse((sent[1] as { context?: string }).context ?? '{}')
    expect(ctx.kind).toBe('plan_approval')
  })

})
