import { describe, expect, it } from 'vitest'
import {
  computeNextRunAt,
  DUE_SLACK_MS,
  evaluateSchedule,
  isDue,
  localWallTimeMs,
  MISS_WINDOW_MS,
  nextDailyAt,
  nextWeeklyAt,
  rollNextRunAt,
} from './schedule'
import type { AutomationTrigger } from './types'

/** Build local epoch for Y-M-D h:m in host TZ. */
function at(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  sec = 0,
  ms = 0,
): number {
  return new Date(y, m - 1, d, h, min, sec, ms).getTime()
}

const daily10: AutomationTrigger = { kind: 'daily', hour: 10, minute: 0 }
const weeklySun10: AutomationTrigger = {
  kind: 'weekly',
  weekday: 0,
  hour: 10,
  minute: 0,
}
const manual: AutomationTrigger = { kind: 'manual' }

describe('computeNextRunAt / nextDailyAt', () => {
  it('manual → null', () => {
    expect(computeNextRunAt(manual, Date.now())).toBeNull()
    expect(rollNextRunAt(manual, Date.now())).toBeNull()
  })

  it('daily: before slot → today', () => {
    const now = at(2026, 7, 27, 9, 0)
    const next = computeNextRunAt(daily10, now)
    expect(next).toBe(at(2026, 7, 27, 10, 0))
  })

  it('daily: exactly at slot → today (due immediately, inclusive seed)', () => {
    const now = at(2026, 7, 27, 10, 0, 0, 0)
    const next = computeNextRunAt(daily10, now)
    expect(next).toBe(at(2026, 7, 27, 10, 0))
  })

  it('daily: after slot → tomorrow', () => {
    const now = at(2026, 7, 27, 10, 0, 1)
    const next = computeNextRunAt(daily10, now)
    expect(next).toBe(at(2026, 7, 28, 10, 0))
  })

  it('daily: month/year boundary roll', () => {
    const now = at(2026, 12, 31, 23, 0)
    const next = nextDailyAt(10, 0, now)
    expect(next).toBe(at(2027, 1, 1, 10, 0))
  })
})

describe('rollNextRunAt (exclusive — no re-fire at lag 0)', () => {
  it('fire_due at exact slot → roll advances past slot; re-eval is noop', () => {
    const slot = at(2026, 7, 27, 10, 0)
    const now = slot // lag 0
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'fire_due',
    })
    // Inclusive seed would return the same slot — roll must not.
    expect(computeNextRunAt(daily10, now)).toBe(slot)
    const rolled = rollNextRunAt(daily10, now)
    expect(rolled).not.toBe(slot)
    expect(rolled).toBe(at(2026, 7, 28, 10, 0))
    expect(
      evaluateSchedule({ nextRunAt: rolled, nowMs: now }),
    ).toEqual({ action: 'noop' })
  })

  it('roll after fire_due with small lag still advances to next day', () => {
    const slot = at(2026, 7, 27, 10, 0)
    const now = slot + 5_000
    const rolled = rollNextRunAt(daily10, now)
    expect(rolled).toBe(at(2026, 7, 28, 10, 0))
    expect(rolled).toBeGreaterThan(now)
  })
})

describe('nextWeeklyAt / weekly Sunday', () => {
  it('weekday=0 aligns with Date.getDay() === 0 (Sunday)', () => {
    // 2026-07-26 is a Sunday
    const sun = new Date(2026, 6, 26)
    expect(sun.getDay()).toBe(0)

    // Saturday 25th morning → next Sunday 10:00
    const sat = at(2026, 7, 25, 9, 0)
    expect(new Date(sat).getDay()).toBe(6)
    const next = nextWeeklyAt(0, 10, 0, sat)
    expect(next).toBe(at(2026, 7, 26, 10, 0))
    expect(new Date(next!).getDay()).toBe(0)
  })

  it('same Sunday before slot → today', () => {
    const now = at(2026, 7, 26, 9, 0)
    expect(computeNextRunAt(weeklySun10, now)).toBe(at(2026, 7, 26, 10, 0))
  })

  it('same Sunday after slot → next week', () => {
    const now = at(2026, 7, 26, 11, 0)
    expect(computeNextRunAt(weeklySun10, now)).toBe(at(2026, 8, 2, 10, 0))
    expect(new Date(at(2026, 8, 2, 10, 0)).getDay()).toBe(0)
  })

  it('weekday 1=Monday', () => {
    // 2026-07-27 is Monday
    expect(new Date(2026, 6, 27).getDay()).toBe(1)
    const sun = at(2026, 7, 26, 12, 0)
    const next = computeNextRunAt(
      { kind: 'weekly', weekday: 1, hour: 9, minute: 30 },
      sun,
    )
    expect(next).toBe(at(2026, 7, 27, 9, 30))
  })
})

describe('evaluateSchedule matrix', () => {
  // daily 10:00, nextRunAt = today 10:00
  const slot = at(2026, 7, 27, 10, 0)

  it('daily 10:00, now=10:00:00 → fire_due', () => {
    const now = at(2026, 7, 27, 10, 0, 0, 0)
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'fire_due',
    })
    expect(isDue(slot, now)).toBe(true)
  })

  it('daily 10:00, now within 30s slack → fire_due', () => {
    const now = slot + DUE_SLACK_MS
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'fire_due',
    })
  })

  it('daily 10:00, now=15:59 lag<6h → fire_catchup once', () => {
    const now = at(2026, 7, 27, 15, 59)
    const lag = now - slot
    expect(lag).toBeLessThan(MISS_WINDOW_MS)
    expect(lag).toBeGreaterThan(DUE_SLACK_MS)
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'fire_catchup',
    })
  })

  it('daily 10:00, lag≥6h → skip_miss and roll to tomorrow 10:00', () => {
    // Design matrix: now=17:00 lag≥6h; use exact 6h boundary (16:00) + roll check
    const now = at(2026, 7, 27, 16, 0)
    expect(now - slot).toBe(MISS_WINDOW_MS)
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'skip_miss',
      reason: 'missed_over_6h',
    })
    // Design: nextRunAt 滚到明日 10:00
    const rolled = rollNextRunAt(daily10, now)
    expect(rolled).toBe(at(2026, 7, 28, 10, 0))
    expect(
      evaluateSchedule({ nextRunAt: rolled, nowMs: now }),
    ).toEqual({ action: 'noop' })
  })

  it('daily 10:00, now=17:00 lag>6h → skip_miss + roll tomorrow', () => {
    const now = at(2026, 7, 27, 17, 0)
    expect(now - slot).toBeGreaterThan(MISS_WINDOW_MS)
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'skip_miss',
      reason: 'missed_over_6h',
    })
    expect(rollNextRunAt(daily10, now)).toBe(at(2026, 7, 28, 10, 0))
  })

  it('lag≥6h coldStart → app_was_quit', () => {
    const now = slot + MISS_WINDOW_MS + 1
    expect(
      evaluateSchedule({
        nextRunAt: slot,
        nowMs: now,
        coldStart: true,
      }),
    ).toEqual({ action: 'skip_miss', reason: 'app_was_quit' })
  })

  it('lag just under 6h → fire_catchup (boundary)', () => {
    const now = slot + MISS_WINDOW_MS - 1
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'fire_catchup',
    })
  })

  it('nextRunAt in future → noop', () => {
    const now = at(2026, 7, 27, 9, 0)
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'noop',
    })
    expect(isDue(slot, now)).toBe(false)
  })

  it('nextRunAt null → noop (caller seeds)', () => {
    expect(
      evaluateSchedule({
        nextRunAt: null,
        nowMs: at(2026, 7, 27, 10, 0),
      }),
    ).toEqual({ action: 'noop' })
  })

  it('manual has no nextRunAt seed → noop (onTick never fires)', () => {
    expect(
      evaluateSchedule({
        nextRunAt: null,
        nowMs: Date.now(),
      }),
    ).toEqual({ action: 'noop' })
    expect(computeNextRunAt(manual, Date.now())).toBeNull()
  })
})

describe('multi-day miss: single catch-up or single skip, no N-chain', () => {
  it('after skip_miss, rollNextRunAt jumps to next future slot only once', () => {
    // Missed many days: nextRunAt was 2026-07-20 10:00, now is 2026-07-27 12:00
    const oldSlot = at(2026, 7, 20, 10, 0)
    const now = at(2026, 7, 27, 12, 0)
    const decision = evaluateSchedule({
      nextRunAt: oldSlot,
      nowMs: now,
      coldStart: true,
    })
    expect(decision.action).toBe('skip_miss')
    // Host rolls once from now — not for each missed day
    const rolled = rollNextRunAt(daily10, now)
    expect(rolled).toBe(at(2026, 7, 28, 10, 0))
    // Second evaluate after roll → noop (future)
    expect(
      evaluateSchedule({
        nextRunAt: rolled,
        nowMs: now,
      }),
    ).toEqual({ action: 'noop' })
  })

  it('after fire_catchup, roll yields one next slot', () => {
    const slot = at(2026, 7, 27, 10, 0)
    const now = at(2026, 7, 27, 12, 0) // lag 2h < 6h
    expect(evaluateSchedule({ nextRunAt: slot, nowMs: now })).toEqual({
      action: 'fire_catchup',
    })
    const rolled = rollNextRunAt(daily10, now)
    expect(rolled).toBe(at(2026, 7, 28, 10, 0))
  })
})

describe('DST portable (local Date; no luxon)', () => {
  /**
   * Portable asserts for any host TZ. Fixed America/New_York wall outcomes live in
   * schedule.dst.test.ts (process.env.TZ pin).
   */
  it('every hour of day constructs without throw', () => {
    for (let h = 0; h < 24; h++) {
      const ms = localWallTimeMs(2026, 3, 8, h, 30)
      expect(Number.isFinite(ms)).toBe(true)
      const next = nextDailyAt(h, 30, ms - 1)
      expect(next).toBeGreaterThanOrEqual(ms - 1)
    }
  })

  it('nextRunAt is strictly monotonic across many daily rolls', () => {
    let prev = computeNextRunAt(daily10, at(2026, 3, 1, 0, 0))!
    for (let i = 0; i < 40; i++) {
      // Simulate fire at prev then exclusive roll
      const next = rollNextRunAt(daily10, prev)!
      expect(next).toBeGreaterThan(prev)
      prev = next
    }
  })

  it('fall-back style: same local time only once per day after roll', () => {
    const slot = at(2026, 11, 1, 1, 30)
    const now = slot // lag 0
    const rolled = rollNextRunAt({ kind: 'daily', hour: 1, minute: 30 }, now)!
    expect(rolled).toBeGreaterThan(slot)
    expect(
      evaluateSchedule({
        nextRunAt: rolled,
        nowMs: now,
      }),
    ).toEqual({ action: 'noop' })
  })
})

describe('isDue', () => {
  it('false for null/undefined/future', () => {
    expect(isDue(null, 100)).toBe(false)
    expect(isDue(undefined, 100)).toBe(false)
    expect(isDue(200, 100)).toBe(false)
  })

  it('true when nextRunAt <= now', () => {
    expect(isDue(100, 100)).toBe(true)
    expect(isDue(50, 100)).toBe(true)
  })
})

describe('constants', () => {
  it('MISS_WINDOW is 6 hours; DUE_SLACK is 30s', () => {
    expect(MISS_WINDOW_MS).toBe(6 * 3600_000)
    expect(DUE_SLACK_MS).toBe(30_000)
  })
})
