import { describe, it, expect } from 'vitest'
import { addUsage, sumUsage } from './usage.js'
import type { TurnUsage } from '@hip/protocol'

describe('usage helpers', () => {
  it('addUsage seeds from undefined accumulator', () => {
    expect(addUsage(undefined, { inputTokens: 3, outputTokens: 2, totalTokens: 5 }))
      .toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 })
  })

  it('addUsage accumulates field-wise across steps', () => {
    const a = addUsage(undefined, { inputTokens: 3, outputTokens: 2, totalTokens: 5 })
    expect(addUsage(a, { inputTokens: 10, outputTokens: 4, totalTokens: 14 }))
      .toEqual({ inputTokens: 13, outputTokens: 6, totalTokens: 19 })
  })

  it('addUsage does not mutate the previous accumulator', () => {
    const a: TurnUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    addUsage(a, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })
    expect(a).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })
  })

  it('sumUsage returns undefined for an empty list (no usage reported)', () => {
    expect(sumUsage([])).toBeUndefined()
    expect(sumUsage([undefined, undefined])).toBeUndefined()
  })

  it('sumUsage adds across agents and skips undefined', () => {
    expect(sumUsage([
      { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      undefined,
      { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    ])).toEqual({ inputTokens: 13, outputTokens: 6, totalTokens: 19 })
  })
})
