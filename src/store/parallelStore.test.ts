import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampParallelCount,
  shortWorktreeLabel,
  slotsForHost,
  useParallelStore,
} from './parallelStore'

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

  it('runsForHost and slotsForHost list nested worktrees', () => {
    useParallelStore.getState().addRun({
      id: 'r1',
      baseCwd: '/tmp/repo',
      prompt: 'fix',
      hostSessionId: 'host',
      source: 'agent',
      slots: [
        {
          index: 2,
          sessionId: '',
          taskId: 't2',
          worktreePath: '/wt/run/b',
          branch: 'b2',
          status: 'ready',
        },
        {
          index: 1,
          sessionId: '',
          taskId: 't1',
          worktreePath: '/wt/run/a',
          branch: 'b1',
          status: 'ready',
        },
      ],
      createdAt: 1,
    })
    expect(useParallelStore.getState().runsForHost('host')).toHaveLength(1)
    expect(useParallelStore.getState().runsForHost('other')).toHaveLength(0)
    const slots = slotsForHost(useParallelStore.getState().runs, 'host')
    expect(slots.map((s) => s.index)).toEqual([1, 2])
  })
})

describe('shortWorktreeLabel', () => {
  it('shows last path segments', () => {
    expect(shortWorktreeLabel('/Users/x/.hip/worktrees/run1/branch-a', 'branch-a')).toBe(
      'run1/branch-a',
    )
    expect(shortWorktreeLabel('', 'only-branch')).toBe('only-branch')
  })
})
