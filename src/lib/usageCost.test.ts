import { describe, it, expect } from 'vitest'
import { computeCost, formatUsd, type CostRate } from './usageCost'

const rate: CostRate = { input: 0.27, output: 1.1 } // models.dev USD / 1e6 tokens (deepseek-chat-ish)

describe('computeCost', () => {
  it('scales tokens by the models.dev per-million unit', () => {
    // 1_000_000 in + 1_000_000 out → exactly input + output dollars
    expect(computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, rate)).toBeCloseTo(1.37, 10)
  })

  it('mixes input and output rates', () => {
    // 500k in × 0.27/1e6 + 250k out × 1.1/1e6 = 0.135 + 0.275 = 0.41
    expect(computeCost({ inputTokens: 500_000, outputTokens: 250_000 }, rate)).toBeCloseTo(0.41, 10)
  })

  it('returns 0 for zero tokens', () => {
    expect(computeCost({ inputTokens: 0, outputTokens: 0 }, rate)).toBe(0)
  })

  it('returns null when no rate is given (token-only)', () => {
    expect(computeCost({ inputTokens: 1000, outputTokens: 1000 }, undefined)).toBeNull()
  })
})

describe('formatUsd', () => {
  it('shows sub-cent costs with enough precision', () => {
    expect(formatUsd(0.0012)).toBe('$0.0012')
  })

  it('rounds normal costs to 4 decimals', () => {
    expect(formatUsd(0.41)).toBe('$0.4100')
  })

  it('shows < $0.0001 for tiny non-zero costs', () => {
    expect(formatUsd(0.00001)).toBe('<$0.0001')
  })

  it('shows $0.00 for exactly zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})
