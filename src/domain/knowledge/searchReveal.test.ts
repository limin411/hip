import { describe, it, expect } from 'vitest'
import { findRevealOffset } from './searchReveal'

describe('findRevealOffset', () => {
  it('finds full query case-insensitively', () => {
    expect(findRevealOffset('Hello UniqueToken world', 'uniquetoken')).toBe(6)
  })

  it('falls back to first token when full query missing', () => {
    const text = 'alpha beta gamma'
    // Multi-token query; only "beta" present as contiguous match via tokenize
    expect(findRevealOffset(text, 'zzz beta')).toBe(6)
  })

  it('returns null when nothing matches', () => {
    expect(findRevealOffset('hello world', 'nomatch')).toBeNull()
  })

  it('returns null for empty query or text', () => {
    expect(findRevealOffset('', 'x')).toBeNull()
    expect(findRevealOffset('hello', '  ')).toBeNull()
  })

  it('finds CJK character tokens', () => {
    expect(findRevealOffset('会话级权限', '权限')).toBe(3)
  })
})
