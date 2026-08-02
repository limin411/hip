import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useGoalStore } from '@/store/goalStore'

const deps: ServerMessageEffectDeps = {
  send: vi.fn(),
  requestDiff: vi.fn(),
  requestCheckpoints: vi.fn(),
  resyncActiveIfRunning: vi.fn(),
}

describe('goal:updated effects (product path)', () => {
  beforeEach(() => {
    useGoalStore.setState({ bySession: {} })
  })

  it('sets goal chrome from goal:updated', () => {
    applyServerMessageEffects(
      {
        type: 'goal:updated',
        sessionId: 's1',
        goal: {
          id: 'g1',
          description: 'Ship feature',
          status: 'active',
          turns: 0,
          maxTurns: 25,
          tokens: 0,
          maxTokens: 200000,
        },
      },
      deps,
    )
    expect(useGoalStore.getState().bySession.s1).toMatchObject({
      id: 'g1',
      description: 'Ship feature',
      status: 'active',
    })
  })

  it('clears goal chrome when goal is null', () => {
    useGoalStore.getState().setGoal('s1', {
      id: 'g1',
      description: 'x',
      status: 'active',
    })
    applyServerMessageEffects({ type: 'goal:updated', sessionId: 's1', goal: null }, deps)
    expect(useGoalStore.getState().bySession.s1).toBeNull()
  })
})
