import { describe, it, expect } from 'vitest'
import { formatTokensCompact } from './formatTokens'

describe('formatTokensCompact', () => {
  it('keeps small integers as-is', () => {
    expect(formatTokensCompact(0)).toBe('0')
    expect(formatTokensCompact(999)).toBe('999')
  })

  it('uses one-decimal k under 10k', () => {
    expect(formatTokensCompact(1_000)).toBe('1k')
    expect(formatTokensCompact(1_200)).toBe('1.2k')
    expect(formatTokensCompact(9_999)).toBe('10k')
  })

  it('uses integer k from 10k to 1M', () => {
    expect(formatTokensCompact(10_000)).toBe('10k')
    expect(formatTokensCompact(12_400)).toBe('12k')
    expect(formatTokensCompact(128_000)).toBe('128k')
  })

  it('uses M at and above 1M', () => {
    expect(formatTokensCompact(1_000_000)).toBe('1M')
    expect(formatTokensCompact(1_500_000)).toBe('1.5M')
  })

  it('guards non-finite / negative', () => {
    expect(formatTokensCompact(Number.NaN)).toBe('0')
    expect(formatTokensCompact(-3)).toBe('0')
  })
})
