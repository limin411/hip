import { describe, expect, it } from 'vitest'
import { ensureScheduleDates, isDefaultScheduleOnly } from './schedule'

const TODAY = '2026-07-25'

describe('ensureScheduleDates', () => {
  it('fills both sides with today when absent', () => {
    expect(ensureScheduleDates({}, TODAY)).toEqual({
      startOn: TODAY,
      endOn: TODAY,
    })
  })

  it('uses end when only end set; start when only start', () => {
    expect(ensureScheduleDates({ endOn: '2026-07-28' }, TODAY)).toEqual({
      startOn: '2026-07-28',
      endOn: '2026-07-28',
    })
    expect(ensureScheduleDates({ startOn: '2026-07-20' }, TODAY)).toEqual({
      startOn: '2026-07-20',
      endOn: '2026-07-20',
    })
  })

  it('swaps inverted range', () => {
    expect(
      ensureScheduleDates({ startOn: '2026-07-28', endOn: '2026-07-20' }, TODAY),
    ).toEqual({ startOn: '2026-07-20', endOn: '2026-07-28' })
  })

  it('maps legacy dueOn to end when end absent', () => {
    expect(ensureScheduleDates({ dueOn: '2026-08-01' }, TODAY)).toEqual({
      startOn: '2026-08-01',
      endOn: '2026-08-01',
    })
  })
})

describe('isDefaultScheduleOnly', () => {
  it('true for nulls and today–today', () => {
    expect(isDefaultScheduleOnly(null, null, TODAY)).toBe(true)
    expect(isDefaultScheduleOnly(TODAY, TODAY, TODAY)).toBe(true)
  })

  it('false for other ranges', () => {
    expect(isDefaultScheduleOnly('2026-07-24', '2026-07-24', TODAY)).toBe(false)
    expect(isDefaultScheduleOnly(TODAY, '2026-07-26', TODAY)).toBe(false)
  })
})
