import { describe, expect, it } from 'vitest'
import {
  groupSessionsByProjectPath,
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
