import { describe, it, expect } from 'vitest'
import type { SessionVM } from '@/domain/sessionStore'
import {
  hasPlanApproval,
  isPlanApprovalInterrupt,
  shouldHideInterruptForPlanApproval,
} from './planApproval'

function sess(partial: Partial<SessionVM>): SessionVM {
  return {
    id: 's1',
    config: { llmProvider: 'deepseek', model: 'm', tools: [] },
    title: '',
    preview: '',
    updatedAtMs: 0,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
    interrupt: null,
    activeTurnPlan: null,
    planDeltaDraft: {},
    planApprovalPending: false,
    codePanelOpen: false,
    chatPanelOpen: false,
    ...partial,
  } as SessionVM
}

describe('hasPlanApproval', () => {
  it('is true when planApprovalPending regardless of plan items', () => {
    expect(hasPlanApproval(sess({ planApprovalPending: true, activeTurnPlan: null }))).toBe(true)
    expect(hasPlanApproval(sess({ planApprovalPending: true, activeTurnPlan: [] }))).toBe(true)
    expect(
      hasPlanApproval(
        sess({
          planApprovalPending: true,
          activeTurnPlan: [{ content: 'a', status: 'pending' }],
        }),
      ),
    ).toBe(true)
  })

  it('is false when planApprovalPending is false/absent even with items', () => {
    expect(
      hasPlanApproval(
        sess({
          planApprovalPending: false,
          activeTurnPlan: [{ content: 'a', status: 'pending' }],
        }),
      ),
    ).toBe(false)
    expect(hasPlanApproval(sess({ planApprovalPending: undefined }))).toBe(false)
    expect(hasPlanApproval(null)).toBe(false)
    expect(hasPlanApproval(undefined)).toBe(false)
  })
})

describe('shouldHideInterruptForPlanApproval (KD-PA-3 / D5.2)', () => {
  const planIntr = {
    turnId: 't1',
    question: 'plan_approval',
    context: JSON.stringify({ kind: 'plan_approval', plan: [] }),
  }

  it('hides when planApprovalPending even with empty checklist', () => {
    expect(shouldHideInterruptForPlanApproval(true, planIntr)).toBe(true)
    expect(shouldHideInterruptForPlanApproval(true, null)).toBe(true)
  })

  it('hides when interrupt context kind is plan_approval even if pending false', () => {
    expect(shouldHideInterruptForPlanApproval(false, planIntr)).toBe(true)
    expect(isPlanApprovalInterrupt(planIntr)).toBe(true)
  })

  it('hides when question is the wire token plan_approval', () => {
    expect(
      shouldHideInterruptForPlanApproval(false, { question: 'plan_approval', context: undefined }),
    ).toBe(true)
  })

  it('does not hide generic interrupts', () => {
    expect(
      shouldHideInterruptForPlanApproval(false, {
        turnId: 't1',
        question: 'Need more info?',
        context: JSON.stringify({ kind: 'doom' }),
      } as { question: string; context: string }),
    ).toBe(false)
    expect(shouldHideInterruptForPlanApproval(false, null)).toBe(false)
  })
})
