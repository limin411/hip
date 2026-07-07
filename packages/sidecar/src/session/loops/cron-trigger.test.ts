import { describe, it, expect } from 'vitest'
import {
  parseField,
  parseCron,
  matches,
  nextRun,
  type CronFields,
} from './cron-trigger.js'

describe('parseField', () => {
  it('wildcard returns full range', () => {
    const result = parseField('*', 0, 59)
    expect(result).toHaveLength(60)
    expect(result[0]).toBe(0)
    expect(result[59]).toBe(59)
  })

  it('single value', () => {
    expect(parseField('5', 0, 59)).toEqual([5])
  })

  it('range', () => {
    expect(parseField('1-5', 0, 59)).toEqual([1, 2, 3, 4, 5])
  })

  it('descending range yields ascending result', () => {
    expect(parseField('5-1', 0, 59)).toEqual([1, 2, 3, 4, 5])
  })

  it('list', () => {
    expect(parseField('1,3,5', 0, 59)).toEqual([1, 3, 5])
  })

  it('step with wildcard', () => {
    const result = parseField('*/15', 0, 59)
    expect(result).toEqual([0, 15, 30, 45])
  })

  it('step with range', () => {
    const result = parseField('1-10/3', 0, 59)
    expect(result).toEqual([1, 4, 7, 10])
  })

  it('step with single value', () => {
    const result = parseField('5/10', 0, 59)
    expect(result).toEqual([5, 15, 25, 35, 45, 55])
  })

  it('month name JAN', () => {
    const names = { jan: 1, feb: 2, mar: 3 }
    expect(parseField('jan,feb,mar', 1, 12, names)).toEqual([1, 2, 3])
  })

  it('day name MON-FRI', () => {
    const names = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 }
    const result = parseField('mon-fri', 0, 7, names)
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('throws on out-of-range value', () => {
    expect(() => parseField('60', 0, 59)).toThrow()
  })

  it('throws on invalid step value', () => {
    expect(() => parseField('*/0', 0, 59)).toThrow()
  })
})

describe('parseCron', () => {
  it('parses a standard 5-field expression', () => {
    const result = parseCron('*/15 9-17 * * 1-5')
    expect(result.minute).toEqual([0, 15, 30, 45])
    expect(result.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(result.dom).toHaveLength(31)
    expect(result.month).toHaveLength(12)
    expect(result.dow).toEqual([1, 2, 3, 4, 5])
  })

  it('parses monthly midnight', () => {
    const result = parseCron('0 0 1 * *')
    expect(result.minute).toEqual([0])
    expect(result.hour).toEqual([0])
    expect(result.dom).toEqual([1])
    expect(result.month).toHaveLength(12)
    expect(result.dow).toHaveLength(8)
  })

  it('parses every minute', () => {
    const result = parseCron('* * * * *')
    expect(result.minute).toHaveLength(60)
    expect(result.hour).toHaveLength(24)
    expect(result.dom).toHaveLength(31)
    expect(result.month).toHaveLength(12)
    expect(result.dow).toHaveLength(8)
  })

  it('throws on wrong number of fields', () => {
    expect(() => parseCron('* * * *')).toThrow('exactly 5 fields')
    expect(() => parseCron('* * * * * *')).toThrow('exactly 5 fields')
  })

  it('throws on empty expression', () => {
    expect(() => parseCron('')).toThrow()
  })
})

describe('matches', () => {
  it('matches every-minute expression', () => {
    const d = new Date('2026-07-07T14:30:00')
    expect(matches('* * * * *', d)).toBe(true)
  })

  it('matches specific minute', () => {
    const d = new Date('2026-07-07T14:30:00')
    expect(matches('30 * * * *', d)).toBe(true)
    expect(matches('31 * * * *', d)).toBe(false)
  })

  it('matches specific hour', () => {
    const d = new Date('2026-07-07T14:00:00')
    expect(matches('0 14 * * *', d)).toBe(true)
    expect(matches('0 15 * * *', d)).toBe(false)
  })

  it('matches specific day of month', () => {
    const d = new Date('2026-07-07T00:00:00')
    expect(matches('0 0 7 * *', d)).toBe(true)
    expect(matches('0 0 8 * *', d)).toBe(false)
  })

  it('matches specific month', () => {
    const d = new Date('2026-07-07T00:00:00')
    expect(matches('0 0 * 7 *', d)).toBe(true)
    expect(matches('0 0 * 6 *', d)).toBe(false)
  })

  it('matches specific day of week (0=Sunday)', () => {
    // 2026-07-07 is a Tuesday (dow=2)
    const d = new Date('2026-07-07T12:00:00')
    expect(matches('* * * * 2', d)).toBe(true)
    expect(matches('* * * * 1', d)).toBe(false)
  })

  it('dow value 7 treated as Sunday', () => {
    // 2026-07-05 is a Sunday (dow=0)
    const d = new Date('2026-07-05T12:00:00')
    expect(matches('* * * * 0', d)).toBe(true)
    expect(matches('* * * * 7', d)).toBe(true)
  })

  it('dom and dow OR semantics', () => {
    // Both dom and dow are non-wildcard: July 7th (Tue) should match either
    const d = new Date('2026-07-07T12:00:00')
    // dom=7 OR dow=2 (Tue)
    expect(matches('* * 7 * 2', d)).toBe(true)
    // dom=7 only
    expect(matches('* * 7 * 5', d)).toBe(true)  // dom matches
    // dow=2 only
    expect(matches('* * 8 * 2', d)).toBe(true)  // dow matches
    // neither
    expect(matches('* * 8 * 5', d)).toBe(false) // neither
  })

  it('hour range in business hours', () => {
    const d = new Date('2026-07-07T10:30:00')
    expect(matches('* 9-17 * * 1-5', d)).toBe(true)
    const dNight = new Date('2026-07-07T20:00:00')
    expect(matches('* 9-17 * * 1-5', dNight)).toBe(false)
  })

  it('weekend check', () => {
    // 2026-07-04 is Saturday
    const d = new Date('2026-07-04T12:00:00')
    expect(matches('* * * * 0,6', d)).toBe(true)
    expect(matches('* * * * 1-5', d)).toBe(false)
  })
})

describe('nextRun', () => {
  it('returns the next matching minute for */5', () => {
    // At 14:03, next */5 should be 14:05
    const from = new Date('2026-07-07T14:03:00')
    const next = nextRun('*/5 * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getMinutes()).toBe(5)
    expect(next!.getHours()).toBe(14)
  })

  it('rounds up to the next minute', () => {
    // At 14:30:45, next * * * * * should be 14:31:00
    const from = new Date('2026-07-07T14:30:45')
    const next = nextRun('* * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getMinutes()).toBe(31)
    expect(next!.getSeconds()).toBe(0)
  })

  it('next run at exact minute match advances to next hour', () => {
    // At 14:30:00, next "31 * * * *" should be 14:31:00
    const from = new Date('2026-07-07T14:30:00')
    const next = nextRun('31 * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getMinutes()).toBe(31)
    expect(next!.getHours()).toBe(14)
  })

  it('next run advances to next hour when current hour has no matches', () => {
    // At 14:30, next "0 15 * * *" should be 15:00
    const from = new Date('2026-07-07T14:30:00')
    const next = nextRun('0 15 * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(15)
    expect(next!.getMinutes()).toBe(0)
  })

  it('next run advances to next day when no more hours today', () => {
    // At 23:30, next "0 8 * * *" should be tomorrow 08:00
    const from = new Date('2026-07-07T23:30:00')
    const next = nextRun('0 8 * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(8)
    expect(next!.getHours()).toBe(8)
    expect(next!.getMinutes()).toBe(0)
  })

  it('next run for monthly (1st day at midnight)', () => {
    // At July 15, next "0 0 1 * *" should be August 1
    const from = new Date('2026-07-15T12:00:00')
    const next = nextRun('0 0 1 * *', from)
    expect(next).not.toBeNull()
    expect(next!.getMonth()).toBe(7) // August (0-indexed)
    expect(next!.getDate()).toBe(1)
    expect(next!.getHours()).toBe(0)
    expect(next!.getMinutes()).toBe(0)
  })

  it('next run for weekdays only', () => {
    // Friday July 3 2026 is a Friday (dow=5)
    // Next weekday after Friday is Monday July 6
    const from = new Date('2026-07-03T23:30:00') // Friday
    const next = nextRun('0 9 * * 1-5', from)
    expect(next).not.toBeNull()
    // Should be Monday July 6
    expect(next!.getDate()).toBe(6)
    expect(next!.getDay()).toBe(1) // Monday
    expect(next!.getHours()).toBe(9)
    expect(next!.getMinutes()).toBe(0)
  })

  it('returns null when no match in reasonable lookahead', () => {
    // This expression can't match (Feb 30)
    const from = new Date('2026-07-07T00:00:00')
    const next = nextRun('0 0 30 2 *', from)
    expect(next).toBeNull()
  })

  it('handles timezone correctly', () => {
    // No timezone shenanigans: Date uses local time, which is what cron does
    const from = new Date('2026-07-07T10:00:00')
    const next = nextRun('0 12 * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(12)
    expect(next!.getMinutes()).toBe(0)
  })

  it('handles step patterns correctly', () => {
    // Every 30 minutes starting from 14:03, next should be 14:30
    const from = new Date('2026-07-07T14:03:00')
    const next = nextRun('*/30 * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getMinutes()).toBe(30)
    expect(next!.getHours()).toBe(14)
  })

  it('next run for specific time was exact', () => {
    // At exactly 14:00, next "0 14 * * *" should be... well the next minute after from
    // Actually, 14:00 matches, so next run should be... Since nextRun starts from
    // the next minute, it should be 14:00 of the next day.
    const from = new Date('2026-07-07T14:00:00')
    const next = nextRun('0 14 * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(8) // next day
    expect(next!.getHours()).toBe(14)
    expect(next!.getMinutes()).toBe(0)
  })
})
