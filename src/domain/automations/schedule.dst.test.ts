/**
 * DST schedule matrix with fixed America/New_York fixture.
 * TZ must be set before Date construction (module top-level).
 *
 * 2026 transitions (US):
 * - Spring forward: 2026-03-08 02:00 EST → 03:00 EDT (2:xx missing)
 * - Fall back: 2026-11-01 02:00 EDT → 01:00 EST (1:xx repeated)
 */
process.env.TZ = 'America/New_York'

import { describe, expect, it } from 'vitest'
import {
  computeNextRunAt,
  evaluateSchedule,
  localWallTimeMs,
  nextDailyAt,
  rollNextRunAt,
} from './schedule'
import type { AutomationTrigger } from './types'

function at(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  sec = 0,
): number {
  return new Date(y, m - 1, d, h, min, sec, 0).getTime()
}

describe('DST America/New_York fixture', () => {
  it('pins TZ so local wall matches Eastern', () => {
    // Mid-winter (EST, UTC-5): noon local → 17:00 UTC
    const jan = new Date(2026, 0, 15, 12, 0, 0, 0)
    expect(jan.getTimezoneOffset()).toBe(5 * 60)
    // Mid-summer (EDT, UTC-4): noon local → 16:00 UTC
    const jul = new Date(2026, 6, 15, 12, 0, 0, 0)
    expect(jul.getTimezoneOffset()).toBe(4 * 60)
  })

  it('spring-forward missing hour: Date does not throw; 2:30 lands on 3:30', () => {
    // 2026-03-08 02:30 does not exist → JS rolls to 03:30 EDT
    const sprung = localWallTimeMs(2026, 3, 8, 2, 30)
    const d = new Date(sprung)
    expect(Number.isFinite(sprung)).toBe(true)
    expect(d.getHours()).toBe(3)
    expect(d.getMinutes()).toBe(30)
  })

  it('spring-forward: daily 02:30 seed lands on post-gap wall time without rethrow', () => {
    const before = at(2026, 3, 8, 1, 0)
    const next = nextDailyAt(2, 30, before)
    expect(Number.isFinite(next)).toBe(true)
    // Candidate is the (rolled) local construction for 2:30 → 3:30
    const wall = new Date(next)
    expect(wall.getFullYear()).toBe(2026)
    expect(wall.getMonth()).toBe(2)
    expect(wall.getDate()).toBe(8)
    expect(wall.getHours()).toBe(3)
    expect(wall.getMinutes()).toBe(30)
  })

  it('spring-forward: exclusive roll after fire does not re-fire same gap slot', () => {
    const daily230: AutomationTrigger = { kind: 'daily', hour: 2, minute: 30 }
    // Seed from early morning
    const seeded = computeNextRunAt(daily230, at(2026, 3, 8, 1, 0))!
    expect(evaluateSchedule({ nextRunAt: seeded, nowMs: seeded })).toEqual({
      action: 'fire_due',
    })
    const rolled = rollNextRunAt(daily230, seeded)!
    expect(rolled).toBeGreaterThan(seeded)
    // Next calendar day 2:30 (Mar 9 is after spring-forward, 2:30 exists as EDT)
    expect(new Date(rolled).getDate()).toBe(9)
    expect(
      evaluateSchedule({ nextRunAt: rolled, nowMs: seeded }),
    ).toEqual({ action: 'noop' })
  })

  it('fall-back repeated hour: same local 01:30 fires once then rolls', () => {
    // 2026-11-01 fall back: 1:xx occurs twice; Date(y,10,1,1,30) picks one instant.
    const slot = localWallTimeMs(2026, 11, 1, 1, 30)
    expect(Number.isFinite(slot)).toBe(true)
    const d = new Date(slot)
    expect(d.getHours()).toBe(1)
    expect(d.getMinutes()).toBe(30)

    const daily130: AutomationTrigger = { kind: 'daily', hour: 1, minute: 30 }
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: slot })).toEqual({
      action: 'fire_due',
    })
    // Exclusive roll → next calendar day 01:30 (not the ambiguous second 01:30 same day)
    const rolled = rollNextRunAt(daily130, slot)!
    expect(rolled).toBeGreaterThan(slot)
    const rd = new Date(rolled)
    expect(rd.getMonth()).toBe(10) // November
    expect(rd.getDate()).toBe(2)
    expect(rd.getHours()).toBe(1)
    expect(rd.getMinutes()).toBe(30)
    expect(
      evaluateSchedule({ nextRunAt: rolled, nowMs: slot }),
    ).toEqual({ action: 'noop' })
  })

  it('fall-back: successive exclusive rolls stay strictly increasing', () => {
    const daily130: AutomationTrigger = { kind: 'daily', hour: 1, minute: 30 }
    let t = at(2026, 10, 30, 0, 0)
    let prev = computeNextRunAt(daily130, t)!
    for (let i = 0; i < 5; i++) {
      const next = rollNextRunAt(daily130, prev)!
      expect(next).toBeGreaterThan(prev)
      prev = next
    }
  })
})
