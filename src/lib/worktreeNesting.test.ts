import { describe, expect, it } from 'vitest'
import {
  collectNestedWorktreeSessionIds,
  collectWorktreeCascadeDeleteIds,
  extractParallelNestingHints,
  isManagedWorktreePath,
  isParallelSlotTitle,
  nestableCatalogPaths,
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

  it('nestableCatalogPaths drops primary main-repo paths', () => {
    expect(
      nestableCatalogPaths([
        { path: '/repo', isPrimary: true },
        { path: '/repo/wt-a', isPrimary: false },
        { path: '', isPrimary: false },
      ]),
    ).toEqual(['/repo/wt-a'])
  })

  it('primary catalog path must not nest the host (click-to-select regression)', () => {
    // Bug: after selectSession → git:worktree:list, primary path === host cwd was
    // passed as worktreePaths and the host vanished from the sidebar.
    const hostCwd = '/Users/x/code/forgejo'
    const nestedIfBuggy = collectNestedWorktreeSessionIds({
      sessions: [{ id: 'host', title: 'Forgejo', config: { cwd: hostCwd } }],
      worktreePaths: [hostCwd], // wrongly included primary
    })
    expect(nestedIfBuggy.has('host')).toBe(true) // documents the failure mode

    const nestedFixed = collectNestedWorktreeSessionIds({
      sessions: [{ id: 'host', title: 'Forgejo', config: { cwd: hostCwd } }],
      worktreePaths: nestableCatalogPaths([
        { path: hostCwd, isPrimary: true },
        { path: '/Users/x/.hip/worktrees/forgejo-slot', isPrimary: false },
      ]),
    })
    expect(nestedFixed.has('host')).toBe(false)
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

  describe('collectWorktreeCascadeDeleteIds', () => {
    it('deletes explicit slot sessions matching removed worktree', () => {
      const r = collectWorktreeCascadeDeleteIds({
        removedPath: '/Users/x/.hip/worktrees/hip-parallel-0',
        removedWorktreeId: 'wt-0',
        runs: [
          {
            hostSessionId: 'host',
            slots: [
              {
                sessionId: 'slot-0',
                worktreeId: 'wt-0',
                worktreePath: '/Users/x/.hip/worktrees/hip-parallel-0',
              },
            ],
          },
        ],
        sessions: [
          { id: 'host', title: 'Project', config: { cwd: '/repo' } },
          {
            id: 'slot-0',
            title: 'P1/2 · run',
            config: { cwd: '/Users/x/.hip/worktrees/hip-parallel-0' },
          },
        ],
      })
      expect(r.toDelete).toEqual(['slot-0'])
      expect(r.skipped).toEqual([])
    })

    it('never cascade-deletes a host session even if cwd matches (blind path bug)', () => {
      const r = collectWorktreeCascadeDeleteIds({
        removedPath: '/repo',
        removedWorktreeId: 'primary',
        runs: [{ hostSessionId: 'host', slots: [] }],
        sessions: [{ id: 'host', title: 'Project', config: { cwd: '/repo' } }],
      })
      expect(r.toDelete).toEqual([])
      expect(r.skipped.some((s) => s.id === 'host' && s.why === 'host-session-protected')).toBe(true)
    })

    it('skips cwd-matched non-slot project sessions', () => {
      const r = collectWorktreeCascadeDeleteIds({
        removedPath: '/Users/x/code/other-project',
        runs: [],
        sessions: [
          {
            id: 'proj',
            title: 'Some project chat',
            config: { cwd: '/Users/x/code/other-project' },
          },
        ],
      })
      expect(r.toDelete).toEqual([])
      expect(r.skipped).toContainEqual({ id: 'proj', why: 'cwd-match-but-not-slot-like' })
    })

    it('allows cwd match when path is managed worktree root', () => {
      const r = collectWorktreeCascadeDeleteIds({
        removedPath: '/Users/x/.hip/worktrees/orphan-slot',
        runs: [],
        sessions: [
          {
            id: 'orphan',
            title: 'stale slot',
            config: { cwd: '/Users/x/.hip/worktrees/orphan-slot' },
          },
        ],
      })
      expect(r.toDelete).toEqual(['orphan'])
    })
  })
})
