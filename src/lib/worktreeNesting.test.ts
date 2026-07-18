import { describe, expect, it } from 'vitest'
import {
  collectNestedWorktreeSessionIds,
  extractParallelNestingHints,
  isManagedWorktreePath,
  isParallelSlotTitle,
  pathKey,
} from './worktreeNesting'

describe('worktreeNesting', () => {
  it('pathKey normalizes trailing slash and backslash', () => {
    expect(pathKey('/a/b/')).toBe('/a/b')
    expect(pathKey('C:\\a\\b\\')).toBe('C:/a/b')
  })

  it('detects managed worktree paths and slot titles', () => {
    expect(isManagedWorktreePath('/Users/x/.hip/worktrees/run/slot')).toBe(true)
    expect(isManagedWorktreePath('/Users/x/.hip/eval-runs/worktrees/x')).toBe(true)
    expect(isManagedWorktreePath('/Users/x/code/repo')).toBe(false)
    expect(isParallelSlotTitle('P1/2 · abcdef')).toBe(true)
    expect(isParallelSlotTitle('项目前后端架构并行分析')).toBe(false)
  })

  it('collects nested ids from slots, paths, managed cwd, and titles', () => {
    const nested = collectNestedWorktreeSessionIds({
      sessions: [
        { id: 'host', title: 'Host project', config: { cwd: '/repo' } },
        { id: 'slot-a', title: 'P1/2 · run1', config: { cwd: '/repo' } },
        {
          id: 'slot-b',
          title: 'orphan managed',
          config: { cwd: '/Users/x/.hip/worktrees/h1/slot-b' },
        },
        {
          id: 'slot-c',
          title: 'from catalog path',
          config: { cwd: '/custom/wt/1' },
        },
        { id: 'normal', title: 'Normal', config: { cwd: '/other' } },
      ],
      slotSessionIds: ['explicit-slot'],
      worktreePaths: ['/custom/wt/1/'],
    })
    expect(nested.has('host')).toBe(false)
    expect(nested.has('normal')).toBe(false)
    expect(nested.has('explicit-slot')).toBe(true)
    expect(nested.has('slot-a')).toBe(true)
    expect(nested.has('slot-b')).toBe(true)
    expect(nested.has('slot-c')).toBe(true)
  })

  it('extractParallelNestingHints pulls sessionIds and paths', () => {
    const hints = extractParallelNestingHints([
      {
        slots: [
          { sessionId: 's1', worktreePath: '/wt/1' },
          { sessionId: '', worktreePath: '/wt/2' },
        ],
      },
    ])
    expect(hints.slotSessionIds).toEqual(['s1'])
    expect(hints.worktreePaths).toEqual(['/wt/1', '/wt/2'])
  })
})
