import { describe, expect, it } from 'vitest'
import { dateBucketFor, groupSessionsByDate } from './sessionDateGroups'

/** 2026-07-27 12:00 local — fixed for deterministic buckets. */
const NOW = new Date(2026, 6, 27, 12, 0, 0).getTime()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('dateBucketFor', () => {
  it('classifies today / yesterday / 7d / 30d / older', () => {
    expect(dateBucketFor(NOW - HOUR, NOW)).toBe('today')
    expect(dateBucketFor(NOW - DAY - HOUR, NOW)).toBe('yesterday')
    expect(dateBucketFor(NOW - 3 * DAY, NOW)).toBe('previous7')
    expect(dateBucketFor(NOW - 14 * DAY, NOW)).toBe('previous30')
    expect(dateBucketFor(NOW - 60 * DAY, NOW)).toBe('older')
  })
})

describe('groupSessionsByDate', () => {
  it('orders buckets and sorts sessions newest-first', () => {
    const sessions = [
      { id: 'old', updatedAtMs: NOW - 60 * DAY },
      { id: 'today-a', updatedAtMs: NOW - HOUR },
      { id: 'today-b', updatedAtMs: NOW - 2 * HOUR },
      { id: 'yest', updatedAtMs: NOW - DAY - HOUR },
    ]
    const groups = groupSessionsByDate(sessions, NOW)
    expect(groups.map((g) => g.bucketId)).toEqual(['today', 'yesterday', 'older'])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['today-a', 'today-b'])
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['yest'])
    expect(groups[2].sessions.map((s) => s.id)).toEqual(['old'])
  })

  it('omits empty buckets', () => {
    const groups = groupSessionsByDate([{ id: 't', updatedAtMs: NOW }], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].bucketId).toBe('today')
  })
})
