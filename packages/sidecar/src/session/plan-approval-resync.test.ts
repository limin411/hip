import { describe, it, expect } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import {
  emitPlanApprovalResync,
  readPlanApprovalPause,
  stripPlanApprovalPause,
  withPlanApprovalPause,
  withoutPlanApprovalPause,
  PLAN_APPROVAL_PAUSE_KEY,
} from './plan-approval-resync.js'
import { PLAN_APPROVAL_QUESTION_TOKEN } from './plan-approval-constants.js'

describe('plan-approval-resync', () => {
  it('round-trips pause marker on config', () => {
    const marker = {
      turnId: 't1',
      plan: [{ content: 'step', status: 'pending' as const }],
      question: PLAN_APPROVAL_QUESTION_TOKEN,
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

  it('readPlanApprovalPause falls back to PLAN_APPROVAL_QUESTION_TOKEN', () => {
    // Missing / empty question → token fallback (D5)
    const withEmptyQ = {
      llmProvider: 'deepseek' as const,
      model: 'deepseek-chat',
      tools: [] as string[],
      [PLAN_APPROVAL_PAUSE_KEY]: { turnId: 't2', plan: [] },
    }
    expect(readPlanApprovalPause(withEmptyQ as never)).toEqual({
      turnId: 't2',
      plan: [],
      question: PLAN_APPROVAL_QUESTION_TOKEN,
    })
  })

  it('emitPlanApprovalResync sends published then interrupt with token question', () => {
    const sent: ServerMessage[] = []
    emitPlanApprovalResync(
      (m) => sent.push(m),
      's1',
      {
        turnId: 'turn-1',
        plan: [{ content: 'a', status: 'pending' }],
        question: PLAN_APPROVAL_QUESTION_TOKEN,
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
      question: PLAN_APPROVAL_QUESTION_TOKEN,
    })
    const ctx = JSON.parse((sent[1] as { context?: string }).context ?? '{}')
    expect(ctx.kind).toBe('plan_approval')
  })

})
