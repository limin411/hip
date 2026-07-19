import { describe, expect, it } from 'vitest'
import {
  isParallelHitlOptionId,
  isWorktreeSourceLabelId,
  resolvePermissionOptionLabel,
  resolveWorktreeSourceLabel,
} from './worktreeHitlLabels'

describe('worktreeHitlLabels', () => {
  it('recognizes parallel HITL optionIds', () => {
    expect(isParallelHitlOptionId('n1')).toBe(true)
    expect(isParallelHitlOptionId('n4')).toBe(true)
    expect(isParallelHitlOptionId('reject')).toBe(true)
    expect(isParallelHitlOptionId('allow')).toBe(false)
    expect(isParallelHitlOptionId('n5')).toBe(false)
  })

  it('maps parallel_worktrees optionIds via t()', () => {
    const t = (key: string, opts?: { defaultValue?: string }) => {
      if (key === 'chat.worktreeControl.hitlOption.n2') return '2 tracks'
      if (key === 'chat.worktreeControl.hitlOption.reject') return "Don't parallelize"
      return opts?.defaultValue ?? key
    }
    expect(
      resolvePermissionOptionLabel(
        { optionId: 'n2', name: '并行 2 路' },
        'parallel_worktrees',
        t,
      ),
    ).toBe('2 tracks')
    expect(
      resolvePermissionOptionLabel(
        { optionId: 'reject', name: '不要并行' },
        'parallel_worktrees',
        t,
      ),
    ).toBe("Don't parallelize")
  })

  it('falls back to server name for non-HITL kinds and unknown optionIds', () => {
    const t = () => 'should-not-use'
    expect(
      resolvePermissionOptionLabel({ optionId: 'allow', name: 'Allow' }, 'shell', t),
    ).toBe('Allow')
    expect(
      resolvePermissionOptionLabel(
        { optionId: 'allow', name: 'Allow once' },
        'parallel_worktrees',
        t,
      ),
    ).toBe('Allow once')
    expect(
      resolvePermissionOptionLabel(
        { optionId: 'n2', name: '并行 2 路' },
        'edit_file',
        t,
      ),
    ).toBe('并行 2 路')
  })

  it('uses defaultValue when t returns empty for hitl key', () => {
    const t = (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? ''
    expect(
      resolvePermissionOptionLabel(
        { optionId: 'n1', name: '隔离 1 路' },
        'parallel_worktrees',
        t,
      ),
    ).toBe('隔离 1 路')
  })

  it('humanizes known WorktreeSource values and hides raw unknowns', () => {
    expect(isWorktreeSourceLabelId('host_fanout')).toBe(true)
    expect(isWorktreeSourceLabelId('git')).toBe(false)

    const t = (key: string) => {
      if (key === 'chat.worktreeControl.source.parallel') return 'Agent parallel'
      if (key === 'chat.worktreeControl.source.host_fanout') return 'Parallel explore'
      return ''
    }
    expect(resolveWorktreeSourceLabel('parallel', t)).toBe('Agent parallel')
    expect(resolveWorktreeSourceLabel('host_fanout', t)).toBe('Parallel explore')
    expect(resolveWorktreeSourceLabel('git', t)).toBeNull()
    expect(resolveWorktreeSourceLabel(undefined, t)).toBeNull()
    expect(resolveWorktreeSourceLabel('protocol', t)).toBeNull() // empty translation → hide
  })
})
