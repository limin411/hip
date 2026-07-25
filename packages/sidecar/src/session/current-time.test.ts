import { describe, it, expect } from 'vitest'
import {
  floorToMinute,
  currentTimeIsoMinute,
  formatUtcOffset,
  formatCurrentTimeText,
} from './current-time.js'

describe('floorToMinute', () => {
  it('zeros seconds and milliseconds', () => {
    const d = new Date('2026-06-21T12:34:56.789Z')
    const floored = floorToMinute(d)
    expect(floored.getSeconds()).toBe(0)
    expect(floored.getMilliseconds()).toBe(0)
  })

  it('is stable within the same local minute', () => {
    const a = new Date('2026-06-21T12:34:01.000Z')
    const b = new Date('2026-06-21T12:34:59.999Z')
    // Same UTC minute → after local floor, ISO may still match when offsets are whole minutes
    expect(currentTimeIsoMinute(a)).toBe(currentTimeIsoMinute(b))
  })
})

describe('formatUtcOffset', () => {
  it('matches Date#getTimezoneOffset sign convention', () => {
    const d = new Date('2026-06-21T12:00:00.000Z')
    const offsetMin = -d.getTimezoneOffset()
    const sign = offsetMin >= 0 ? '+' : '-'
    const abs = Math.abs(offsetMin)
    const expected =
      abs % 60 === 0
        ? `UTC${sign}${abs / 60}`
        : `UTC${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
    expect(formatUtcOffset(d)).toBe(expected)
  })
})

describe('formatCurrentTimeText', () => {
  it('includes local time, timezone id, offset, and UTC line', () => {
    const d = new Date('2026-06-21T12:34:56.789Z')
    const text = formatCurrentTimeText(d)
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(
      /^Current local time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00 \(.+, UTC[+-].+\)\.$/,
    )
    // Minute-floored UTC is deterministic for whole-minute offsets
    expect(lines[1]).toBe('UTC: 2026-06-21 12:34:00.')
  })

  it('defaults to now when no date is passed', () => {
    const text = formatCurrentTimeText()
    expect(text).toMatch(/^Current local time: /)
    expect(text).toContain('\nUTC: ')
  })
})
