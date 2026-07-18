import { beforeEach, describe, expect, it } from 'vitest'
import { useGoalStore } from './goalStore'

describe('goalStore (P5 I1)', () => {
  beforeEach(() => {
    useGoalStore.setState({ bySession: {} })
  })

  it('sets and clears goal on complete', () => {
    useGoalStore.getState().setGoal('s1', {
      id: 'g1',
      description: 'Ship it',
      status: 'active',
      turns: 1,
      maxTurns: 10,
    })
    expect(useGoalStore.getState().bySession.s1?.status).toBe('active')
    useGoalStore.getState().updateStatus('s1', 'paused')
    expect(useGoalStore.getState().bySession.s1?.status).toBe('paused')
    useGoalStore.getState().updateStatus('s1', 'blocked')
    expect(useGoalStore.getState().bySession.s1?.status).toBe('blocked')
    useGoalStore.getState().updateStatus('s1', 'completed')
    expect(useGoalStore.getState().bySession.s1).toBeNull()
  })
})
