import { describe, it, expect } from 'vitest'
import type { SessionVM } from '@/domain/sessionStore'
import { hasPlanApproval } from './planApproval'

function sess(over: Partial<SessionVM> = {}): SessionVM {
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
    ...over,
  }
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
