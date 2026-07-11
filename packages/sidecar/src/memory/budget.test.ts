import { describe, it, expect } from 'vitest'
import { getMemoryCoreBudget, getMemoryPrefetchBudget } from './budget.js'

describe('getMemoryCoreBudget', () => {
  it('uses default 128k window → dynamic 2560, min with hard 1500', () => {
    // floor(128000 * 0.005 * 4) = 2560; min(configMax, 2560, 1500)
    expect(getMemoryCoreBudget(1500)).toBe(1500)
    expect(getMemoryCoreBudget(2000)).toBe(1500)
    expect(getMemoryCoreBudget(800)).toBe(800)
  })

  it('tightens with smaller context window', () => {
    // floor(10000 * 0.005 * 4) = 200
    expect(getMemoryCoreBudget(1500, 10_000)).toBe(200)
  })
})

describe('getMemoryPrefetchBudget', () => {
  it('uses default 128k → dynamic 4096, min with hard 2500', () => {
    // floor(128000 * 0.008 * 4) = 4096; min(configMax, 4096, 2500)
    expect(getMemoryPrefetchBudget(2500)).toBe(2500)
    expect(getMemoryPrefetchBudget(5000)).toBe(2500)
    expect(getMemoryPrefetchBudget(1000)).toBe(1000)
  })

  it('tightens with smaller context window', () => {
    // floor(10000 * 0.008 * 4) = 320
    expect(getMemoryPrefetchBudget(2500, 10_000)).toBe(320)
  })
})
