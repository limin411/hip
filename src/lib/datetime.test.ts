import { describe, it, expect } from 'vitest'
import { formatClockTime, formatAbsolute, formatRelativeTime } from './datetime'

const NOW = Date.UTC(2026, 5, 9, 12, 0, 0) // 2026-06-09T12:00:00Z

describe('formatRelativeTime', () => {
  it('"now" for <1s, seconds for <1m (en)', () => {
    expect(formatRelativeTime(NOW, 'en', NOW)).toBe('now')
    expect(formatRelativeTime(NOW - 30_000, 'en', NOW)).toBe('30 seconds ago')
  })
  it('minutes / hours / yesterday (en)', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, 'en', NOW)).toBe('2 minutes ago')
    expect(formatRelativeTime(NOW - 3 * 3_600_000, 'en', NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(NOW - 25 * 3_600_000, 'en', NOW)).toBe('yesterday')
  })
  it('localizes to zh-CN (differs from en, contains CJK)', () => {
    const zh = formatRelativeTime(NOW - 2 * 60_000, 'zh-CN', NOW)
    expect(zh).not.toBe('2 minutes ago')
    expect(zh).toContain('分钟')
  })
})

describe('formatClockTime / formatAbsolute', () => {
  it('clock time contains an H:MM pattern', () => {
    expect(formatClockTime(NOW, 'en')).toMatch(/\d{1,2}:\d{2}/)
  })
  it('absolute contains the year', () => {
    expect(formatAbsolute(NOW, 'en')).toContain('2026')
  })
})
