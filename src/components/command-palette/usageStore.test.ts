// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadCommandUsage,
  recordCommandUsage,
  usageBoost,
} from './usageStore'

const KEY = 'hip.commandPalette.usage.v1'

beforeEach(() => {
  localStorage.clear()
})

describe('usageStore', () => {
  it('records and loads usage', () => {
    recordCommandUsage('nav-settings', 1000)
    recordCommandUsage('nav-settings', 2000)
    const map = loadCommandUsage()
    expect(map['nav-settings']?.count).toBe(2)
    expect(map['nav-settings']?.lastUsedAtMs).toBe(2000)
  })

  it('usageBoost is positive and capped', () => {
    const boost = usageBoost({ count: 100, lastUsedAtMs: Date.now() })
    expect(boost).toBeGreaterThan(0)
    expect(boost).toBeLessThanOrEqual(0.15)
  })

  it('usageBoost is 0 for missing entry', () => {
    expect(usageBoost(undefined)).toBe(0)
  })

  it('persists under known key', () => {
    recordCommandUsage('x', 1)
    expect(localStorage.getItem(KEY)).toContain('nav-settings'.slice(0, 0) + 'x')
    expect(JSON.parse(localStorage.getItem(KEY)!).x.count).toBe(1)
  })
})
