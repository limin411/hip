import { describe, it, expect } from 'vitest'
import { pathBasename, shortSha, sumDiffStats } from './panelContextSlotModel'

describe('panelContextSlotModel', () => {
  it('pathBasename handles posix and windows paths', () => {
    expect(pathBasename('/Users/me/hip/App.tsx')).toBe('App.tsx')
    expect(pathBasename('C:\\proj\\src\\a.ts')).toBe('a.ts')
    expect(pathBasename('/Users/me/hip/')).toBe('hip')
    expect(pathBasename('')).toBe('')
  })

  it('shortSha trims to 7 chars', () => {
    expect(shortSha('abcdef0123456789')).toBe('abcdef0')
    expect(shortSha('abc')).toBe('abc')
  })

  it('sumDiffStats aggregates additions and deletions', () => {
    expect(
      sumDiffStats([
        { additions: 2, deletions: 1 },
        { additions: 3, deletions: 4 },
      ]),
    ).toEqual({ fileCount: 2, additions: 5, deletions: 5 })
    expect(sumDiffStats([])).toEqual({ fileCount: 0, additions: 0, deletions: 0 })
  })
})
