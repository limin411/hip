import { describe, it, expect } from 'vitest'
import { computePercentage, zoneForPercent } from './tokenPercentage'

describe('computePercentage', () => {
  it('64000/128000 → 50', () => {
    expect(computePercentage(64000, 128000)).toBe(50)
  })

  it('0/128000 → 0', () => {
    expect(computePercentage(0, 128000)).toBe(0)
  })

  it('128000/128000 → 100', () => {
    expect(computePercentage(128000, 128000)).toBe(100)
  })

  it('50000/200000 → 25', () => {
    expect(computePercentage(50000, 200000)).toBe(25)
  })

  it('150000/128000 → 100 (clamped)', () => {
    expect(computePercentage(150000, 128000)).toBe(100)
  })

  it('null/128000 → null', () => {
    expect(computePercentage(null, 128000)).toBeNull()
  })

  it('50000/undefined → null', () => {
    expect(computePercentage(50000, undefined)).toBeNull()
  })

  it('50000/0 → null', () => {
    expect(computePercentage(50000, 0)).toBeNull()
  })
})

describe('zoneForPercent', () => {
  it('30 → success', () => {
    expect(zoneForPercent(30)).toBe('success')
  })

  it('49 → success', () => {
    expect(zoneForPercent(49)).toBe('success')
  })

  it('50 → warning', () => {
    expect(zoneForPercent(50)).toBe('warning')
  })

  it('79 → warning', () => {
    expect(zoneForPercent(79)).toBe('warning')
  })

  it('80 → danger', () => {
    expect(zoneForPercent(80)).toBe('danger')
  })

  it('95 → danger', () => {
    expect(zoneForPercent(95)).toBe('danger')
  })

  it('null → null', () => {
    expect(zoneForPercent(null)).toBeNull()
  })
})
