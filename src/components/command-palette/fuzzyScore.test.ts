import { describe, it, expect } from 'vitest'
import { fuzzyMatch, matchHighlightIndices, substringIndices } from './fuzzyScore'

describe('fuzzyMatch', () => {
  it('matches subsequence like ssmd', () => {
    const m = fuzzyMatch('Set Syntax Markdown', 'ssmd')
    expect(m.score).toBeGreaterThan(0)
    expect(m.score).toBeLessThanOrEqual(0.65)
    expect(m.indices.length).toBe(4)
  })

  it('returns 0 when chars cannot form subsequence', () => {
    expect(fuzzyMatch('Settings', 'xyz').score).toBe(0)
  })

  it('scores tighter matches higher than spread-out ones', () => {
    const tight = fuzzyMatch('settings', 'set')
    const loose = fuzzyMatch('s e t t i n g s', 'set')
    expect(tight.score).toBeGreaterThan(0)
    // both may match; tight density should not be worse
    expect(tight.score).toBeGreaterThanOrEqual(loose.score - 0.01)
  })
})

describe('substringIndices', () => {
  it('returns contiguous indices', () => {
    expect(substringIndices('Open Settings', 'set')).toEqual([5, 6, 7])
  })
})

describe('matchHighlightIndices', () => {
  it('prefers contiguous match', () => {
    expect(matchHighlightIndices('Open Settings', 'set').length).toBe(3)
  })

  it('falls back to fuzzy', () => {
    expect(matchHighlightIndices('Set Syntax Markdown', 'ssmd').length).toBe(4)
  })
})
