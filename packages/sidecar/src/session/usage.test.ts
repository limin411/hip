import { describe, it, expect } from 'vitest'
import { addUsage, sumUsage, stepContextTokens } from './usage.js'
import type { TurnUsage } from '@hip/protocol'

describe('usage helpers', () => {
  it('stepContextTokens prefers contextTokens then input then total', () => {
    expect(stepContextTokens({ inputTokens: 10, outputTokens: 2, totalTokens: 12, contextTokens: 9 })).toBe(9)
    expect(stepContextTokens({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })).toBe(10)
    expect(stepContextTokens({ inputTokens: 0, outputTokens: 2, totalTokens: 12 })).toBe(12)
  })

  it('addUsage seeds from undefined accumulator with contextTokens', () => {
    expect(addUsage(undefined, { inputTokens: 3, outputTokens: 2, totalTokens: 5 }))
      .toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5, contextTokens: 3 })
  })

  it('addUsage accumulates billing fields and keeps last step contextTokens', () => {
    const a = addUsage(undefined, { inputTokens: 100_000, outputTokens: 200, totalTokens: 100_200 })
    expect(addUsage(a, { inputTokens: 200_000, outputTokens: 400, totalTokens: 200_400 }))
      .toEqual({
        inputTokens: 300_000,
        outputTokens: 600,
        totalTokens: 300_600,
        contextTokens: 200_000,
      })
  })

  it('addUsage does not mutate the previous accumulator', () => {
    const a: TurnUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, contextTokens: 1 }
    addUsage(a, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })
    expect(a).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2, contextTokens: 1 })
  })

  it('sumUsage returns undefined for an empty list (no usage reported)', () => {
    expect(sumUsage([])).toBeUndefined()
    expect(sumUsage([undefined, undefined])).toBeUndefined()
  })

  it('sumUsage adds billing fields and takes max contextTokens across agents', () => {
    expect(sumUsage([
      { inputTokens: 300_000, outputTokens: 20, totalTokens: 300_020, contextTokens: 200_000 },
      undefined,
      { inputTokens: 50_000, outputTokens: 5, totalTokens: 50_005, contextTokens: 40_000 },
    ])).toEqual({
      inputTokens: 350_000,
      outputTokens: 25,
      totalTokens: 350_025,
      contextTokens: 200_000,
    })
  })
})
