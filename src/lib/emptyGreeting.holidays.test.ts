import { describe, it, expect } from 'vitest'
import {
  HOLIDAYS,
  LUNAR_ANCHORS,
  matchHoliday,
  nthWeekdayOfMonth,
} from './emptyGreeting.holidays'
import { EMPTY_GREETING } from './emptyGreeting.keys'

describe('holiday registry contract', () => {
  it('has exactly 10 frozen definitions', () => {
    expect(HOLIDAYS).toHaveLength(10)
  })

  it('every holiday id has EMPTY_GREETING.holiday keys', () => {
    for (const def of HOLIDAYS) {
      expect(EMPTY_GREETING.holiday[def.id]).toBeDefined()
      expect(EMPTY_GREETING.holiday[def.id].id).toBe(`holiday:${def.id}`)
    }
  })

  it('registry order: new-year is first', () => {
    expect(HOLIDAYS[0]?.id).toBe('new-year')
  })
})

describe('lunar anchors coverage', () => {
  it('covers currentYear and currentYear+1 for every anchor set', () => {
    const y = new Date().getFullYear()
    for (const [id, rows] of Object.entries(LUNAR_ANCHORS)) {
      expect(
        rows.some((r) => r.year === y),
        `${id} missing anchor for ${y}`,
      ).toBe(true)
      expect(
        rows.some((r) => r.year === y + 1),
        `${id} missing anchor for ${y + 1}`,
      ).toBe(true)
    }
  })
})

describe('nthWeekdayOfMonth', () => {
  it('4th Thursday of Nov 2025 is 27', () => {
    expect(nthWeekdayOfMonth(2025, 11, 4, 4)).toBe(27)
  })

  it('4th Thursday of Nov 2026 is 26', () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe(26)
  })
})

describe('matchHoliday golden weeks / national days', () => {
  it('jp-golden-week spans 4/29–5/5', () => {
    expect(
      matchHoliday('JP', { year: 2026, month: 4, day: 29, hour: 12, weekday: 3 })?.id,
    ).toBe('jp-golden-week')
    expect(
      matchHoliday('JP', { year: 2026, month: 5, day: 5, hour: 12, weekday: 2 })?.id,
    ).toBe('jp-golden-week')
    expect(
      matchHoliday('JP', { year: 2026, month: 5, day: 6, hour: 12, weekday: 3 }),
    ).toBeNull()
  })

  it('tw-national-day only on TW 10/10', () => {
    expect(
      matchHoliday('TW', { year: 2026, month: 10, day: 10, hour: 9, weekday: 6 })?.id,
    ).toBe('tw-national-day')
    expect(
      matchHoliday('CN', { year: 2026, month: 10, day: 10, hour: 9, weekday: 6 }),
    ).toBeNull()
  })
})
