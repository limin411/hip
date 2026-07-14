import { describe, it, expect } from 'vitest'
import { findRevealMatch, findRevealOffset } from './searchReveal'

describe('findRevealMatch', () => {
  it('finds full query case-insensitively with full length', () => {
    expect(findRevealMatch('Hello UniqueToken world', 'uniquetoken')).toEqual({
      offset: 6,
      length: 'uniquetoken'.length,
    })
  })

  it('token fallback uses token length, not full query length', () => {
    const text = 'alpha beta gamma'
    // Multi-token query; only "beta" present as contiguous match
    expect(findRevealMatch(text, 'zzz beta')).toEqual({
      offset: 6,
      length: 'beta'.length,
    })
  })

  it('returns null when nothing matches', () => {
    expect(findRevealMatch('hello world', 'nomatch')).toBeNull()
  })

  it('returns null for empty query or text', () => {
    expect(findRevealMatch('', 'x')).toBeNull()
    expect(findRevealMatch('hello', '  ')).toBeNull()
  })

  it('finds CJK character tokens with correct length', () => {
    expect(findRevealMatch('会话级权限', '权限')).toEqual({ offset: 3, length: 2 })
  })

  it('findRevealOffset mirrors match.offset', () => {
    expect(findRevealOffset('Hello UniqueToken world', 'uniquetoken')).toBe(6)
    expect(findRevealOffset('hello', 'nomatch')).toBeNull()
  })
})
