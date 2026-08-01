import { describe, expect, it } from 'vitest'
import {
  groupSessionsByProjectPath,
  listOpenProjectFolders,
  projectPathBasename,
  projectPathKey,
} from './sessionProjectGroups'

function sess(id: string, cwd: string | undefined, updatedAtMs: number) {
  return { id, updatedAtMs, config: { cwd } }
}

describe('projectPathKey', () => {
  it('normalizes slashes and trailing slash', () => {
    expect(projectPathKey('/Users/x/proj/')).toBe('/Users/x/proj')
    expect(projectPathKey('C:\\Users\\x\\proj\\')).toBe('C:/Users/x/proj')
  })

  it('empty for missing cwd', () => {
    expect(projectPathKey(undefined)).toBe('')
    expect(projectPathKey('')).toBe('')
    expect(projectPathKey('   ')).toBe('')
  })
})

describe('projectPathBasename', () => {
  it('returns last segment', () => {
    expect(projectPathBasename('/Users/x/data/hip')).toBe('hip')
    expect(projectPathBasename('/Users/x/data/hip/')).toBe('hip')
  })
})

describe('groupSessionsByProjectPath', () => {
  it('groups by cwd and sorts sessions newest-first within group', () => {
    const groups = groupSessionsByProjectPath([
      sess('a', '/p/hip', 100),
      sess('b', '/p/hip', 300),
      sess('c', '/p/other', 200),
    ])
    expect(groups.map((g) => g.pathKey)).toEqual(['/p/hip', '/p/other'])
    expect(groups[0].label).toBe('hip')
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['b', 'a'])
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['c'])
  })

  it('orders groups by newest session', () => {
    const groups = groupSessionsByProjectPath([
      sess('old', '/p/old', 10),
      sess('new', '/p/new', 99),
    ])
    expect(groups.map((g) => g.pathKey)).toEqual(['/p/new', '/p/old'])
  })

  it('puts unbound (no cwd) last', () => {
    const groups = groupSessionsByProjectPath([
      sess('u', undefined, 999),
      sess('b', '/p/bound', 1),
    ])
    expect(groups.map((g) => g.pathKey)).toEqual(['/p/bound', ''])
    expect(groups[1].label).toBe('')
    expect(groups[1].cwd).toBeNull()
  })

  it('treats trailing-slash paths as same group', () => {
    const groups = groupSessionsByProjectPath([
      sess('a', '/p/hip', 1),
      sess('b', '/p/hip/', 2),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].sessions).toHaveLength(2)
  })
})

describe('listOpenProjectFolders', () => {
  it('returns unique code session folders newest-first and skips chat/unbound', () => {
    const folders = listOpenProjectFolders([
      { updatedAtMs: 10, config: { surface: 'code', cwd: '/p/old' } },
      { updatedAtMs: 50, config: { surface: 'code', cwd: '/p/new' } },
      { updatedAtMs: 99, config: { surface: 'chat', cwd: '/p/sandbox' } },
      { updatedAtMs: 80, config: { surface: 'code' } },
      { updatedAtMs: 40, config: { surface: 'code', cwd: '/p/new/' } },
    ])
    expect(folders.map((f) => f.pathKey)).toEqual(['/p/new', '/p/old'])
    expect(folders[0]).toMatchObject({ label: 'new', cwd: '/p/new' })
  })

  it('treats workspaceMode project as code even without surface', () => {
    const folders = listOpenProjectFolders([
      { updatedAtMs: 1, config: { workspaceMode: 'project', cwd: '/work/a' } },
    ])
    expect(folders).toEqual([{ pathKey: '/work/a', cwd: '/work/a', label: 'a' }])
  })

  it('skips managed worktree dirs (parallel slots / background worktrees)', () => {
    const folders = listOpenProjectFolders([
      { updatedAtMs: 99, config: { surface: 'code', cwd: '/Users/x/.hip/worktrees/run/slot' } },
      { updatedAtMs: 50, config: { surface: 'code', cwd: '/Users/x/.hip/eval-runs/worktrees/slot' } },
      { updatedAtMs: 40, config: { surface: 'code', cwd: '/Users/x/real-proj' } },
      // Relocated worktrees root (HIP_DATA_DIR under macOS temp, e2e leftovers).
      {
        updatedAtMs: 10,
        config: {
          surface: 'code',
          cwd: '/var/folders/gn/xyz/T/hip-e2e-data-abc/worktrees/run/hip-parallel-0',
        },
      },
    ])
    expect(folders.map((f) => f.pathKey)).toEqual(['/Users/x/real-proj'])
  })
})
