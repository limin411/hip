import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampParallelCount,
  shortWorktreeLabel,
  slotsForHost,
  useParallelStore,
} from './parallelStore'

describe('clampParallelCount', () => {
  it('clamps to 1..4 (agent-decided N bounds)', () => {
    expect(clampParallelCount(0)).toBe(1)
    expect(clampParallelCount(1)).toBe(1)
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

  it('pruneSlotsMatching drops slots by path and worktreeId, removes empty runs', () => {
    useParallelStore.getState().addRun({
      id: 'r1',
      baseCwd: '/tmp/repo',
      prompt: 'p',
      hostSessionId: 'host',
      source: 'agent',
      selectedSessionId: 's-gone',
      slots: [
        {
          index: 0,
          sessionId: 's-gone',
          worktreeId: 'wt-0',
          worktreePath: '/Users/x/.hip/worktrees/hip-parallel-0/',
          branch: 'hip-parallel-0',
          status: 'ready',
        },
        {
          index: 1,
          sessionId: 's-keep',
          worktreeId: 'wt-1',
          worktreePath: '/Users/x/.hip/worktrees/hip-parallel-1',
          branch: 'hip-parallel-1',
          status: 'ready',
        },
      ],
      createdAt: 1,
    })
    useParallelStore.getState().pruneSlotsMatching({
      paths: ['/Users/x/.hip/worktrees/hip-parallel-0'],
      worktreeIds: [],
    })
    let run = useParallelStore.getState().runs[0]!
    expect(run.slots).toHaveLength(1)
    expect(run.slots[0]!.worktreeId).toBe('wt-1')
    expect(run.selectedSessionId).toBeUndefined()

    useParallelStore.getState().pruneSlotsMatching({ worktreeIds: ['wt-1'] })
    expect(useParallelStore.getState().runs).toHaveLength(0)
  })

  it('reconcileToLivePaths prunes only the given host and keeps in-flight creates', () => {
    useParallelStore.getState().addRun({
      id: 'r-host',
      baseCwd: '/tmp/repo',
      prompt: 'p',
      hostSessionId: 'host',
      source: 'agent',
      slots: [
        {
          index: 0,
          sessionId: '',
          taskId: 't0',
          worktreePath: '/wt/gone',
          branch: 'gone',
          status: 'ready',
        },
        {
          index: 1,
          sessionId: '',
          taskId: 't1',
          worktreePath: '/wt/live',
          branch: 'live',
          status: 'ready',
        },
        {
          index: 2,
          sessionId: '',
          taskId: 't2',
          worktreePath: '',
          branch: 'pending',
          status: 'creating',
        },
      ],
      createdAt: 1,
    })
    useParallelStore.getState().addRun({
      id: 'r-other',
      baseCwd: '/tmp/other',
      prompt: 'p',
      hostSessionId: 'other',
      source: 'agent',
      slots: [
        {
          index: 0,
          sessionId: '',
          worktreePath: '/wt/other-only',
          branch: 'o',
          status: 'ready',
        },
      ],
      createdAt: 2,
    })

    useParallelStore.getState().reconcileToLivePaths(['/wt/live', '/tmp/repo'], 'host')
    const host = useParallelStore.getState().runs.find((r) => r.id === 'r-host')!
    expect(host.slots.map((s) => s.taskId)).toEqual(['t1', 't2'])
    expect(useParallelStore.getState().runs.find((r) => r.id === 'r-other')?.slots).toHaveLength(1)
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
