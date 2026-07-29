import { describe, it, expect } from 'vitest'
import { growthForZone } from './IsoPlot'

describe('growthForZone', () => {
  it('maps fail/blocked to wilted', () => {
    expect(growthForZone('fail', 1)).toBe(0)
    expect(growthForZone('blocked', 0.5)).toBe(0)
  })

  it('maps done to harvest', () => {
    expect(growthForZone('done', null)).toBe(3)
  })

  it('maps running to growing', () => {
    expect(growthForZone('running', 0.2)).toBe(2)
    expect(growthForZone('running', 0.9)).toBe(3)
  })

  it('maps idle to seedling', () => {
    expect(growthForZone('idle', null)).toBe(1)
    expect(growthForZone('idle', 0.6)).toBe(2)
  })
})
