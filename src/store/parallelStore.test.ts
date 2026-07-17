import { describe, it, expect, beforeEach } from 'vitest'
import { clampParallelCount, useParallelStore } from './parallelStore'

describe('clampParallelCount', () => {
  it('clamps to 2..4', () => {
    expect(clampParallelCount(1)).toBe(2)
    expect(clampParallelCount(2)).toBe(2)
    expect(clampParallelCount(3)).toBe(3)
    expect(clampParallelCount(9)).toBe(4)
    expect(clampParallelCount(Number.NaN)).toBe(2)
  })
})

describe('parallelStore', () => {
  beforeEach(() => {
    useParallelStore.setState({ runs: [] })
  })

  it('adds and finds runs by session', () => {
    useParallelStore.getState().addRun({
      id: 'r1',
      baseCwd: '/tmp/repo',
      prompt: 'fix',
      hostSessionId: 'host',
      slots: [
        {
          index: 1,
          sessionId: 's1',
          worktreePath: '/wt/1',
          branch: 'b1',
          status: 'ready',
        },
      ],
      createdAt: 1,
    })
    expect(useParallelStore.getState().findRunBySessionId('s1')?.id).toBe('r1')
    expect(useParallelStore.getState().findRunBySessionId('host')?.id).toBe('r1')
    useParallelStore.getState().selectWinner('r1', 's1')
    expect(useParallelStore.getState().runs[0]?.selectedSessionId).toBe('s1')
  })
})
