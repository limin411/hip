import { describe, it, expect } from 'vitest'
import { filterSessions, surfaceOf, filterBySurface, groupSessionsByRelativeDate } from './sessions'

interface TestSession {
  id: string
  title: string
  preview: string
  updatedAt: string
}

const data: TestSession[] = [
  { id: '1', title: 'WebSocket 重构', preview: 'ws client', updatedAt: '' },
  { id: '2', title: '布局', preview: '三栏 layout', updatedAt: '' },
]

describe('filterSessions', () => {
  it('returns all when query empty', () => {
    expect(filterSessions(data, '')).toHaveLength(2)
  })

  it('matches title case-insensitively', () => {
    expect(filterSessions(data, 'websocket')).toHaveLength(1)
  })

  it('matches preview text', () => {
    expect(filterSessions(data, 'layout')).toHaveLength(1)
  })

  it('returns empty on no match', () => {
    expect(filterSessions(data, 'zzz')).toHaveLength(0)
  })
})

describe('surfaceOf (frontend)', () => {
  it('returns the explicit surface', () => {
    expect(surfaceOf({ surface: 'chat' })).toBe('chat')
    expect(surfaceOf({ surface: 'code' })).toBe('code')
  })
  it('defaults to code when absent (the sidecar normally stamps it)', () => {
    expect(surfaceOf({})).toBe('code')
    expect(surfaceOf({ surface: undefined })).toBe('code')
  })
})

describe('filterBySurface', () => {
  const mk = (id: string, surface?: 'chat' | 'code') => ({ id, config: { surface } })
  it('keeps only sessions whose surface matches', () => {
    const list = [mk('a', 'chat'), mk('b', 'code'), mk('c', 'chat')]
    expect(filterBySurface(list, 'chat').map((s) => s.id)).toEqual(['a', 'c'])
    expect(filterBySurface(list, 'code').map((s) => s.id)).toEqual(['b'])
  })
  it('treats a missing surface as code', () => {
    const list = [mk('a'), mk('b', 'chat')]
    expect(filterBySurface(list, 'code').map((s) => s.id)).toEqual(['a'])
  })
})

describe('groupSessionsByRelativeDate', () => {
  const now = new Date('2026-06-25T14:00:00').getTime()

  it('groups sessions into today, yesterday, and older', () => {
    const sessions = [
      { id: 'today-1', updatedAtMs: now - 3_600_000 },
      { id: 'today-2', updatedAtMs: now - 60_000 },
      { id: 'yesterday', updatedAtMs: now - 86_400_000 },
      { id: 'older', updatedAtMs: now - 86_400_000 * 3 },
    ]
    const result = groupSessionsByRelativeDate(sessions, now)
    expect(result.map((g) => g.key)).toEqual(['today', 'yesterday', 'older'])
    expect(result[0].sessions.map((s) => s.id)).toEqual(['today-1', 'today-2'])
    expect(result[1].sessions.map((s) => s.id)).toEqual(['yesterday'])
    expect(result[2].sessions.map((s) => s.id)).toEqual(['older'])
  })

  it('omits empty groups', () => {
    const result = groupSessionsByRelativeDate(
      [{ id: 'only-today', updatedAtMs: now - 60_000 }],
      now,
    )
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('today')
  })

  it('returns empty array for no sessions', () => {
    expect(groupSessionsByRelativeDate([], now)).toEqual([])
  })

  it('uses local calendar date for yesterday boundary (DST-safe)', () => {
    // 2026-03-09 is the day after the US spring-forward DST transition (Mar 8 has 23 hours).
    // Going back exactly 86_400_000 ms from Mar 9 noon lands at Mar 8 11:00, not Mar 8 midnight.
    const dstNow = new Date('2026-03-09T12:00:00').getTime()
    const dayStart = (ms: number): number => {
      const d = new Date(ms)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    const yesterdayMidnight = dayStart(dstNow - 86_400_000)

    const result = groupSessionsByRelativeDate(
      [{ id: 'dst-yesterday', updatedAtMs: yesterdayMidnight }],
      dstNow,
    )
    expect(result.map((g) => g.key)).toEqual(['yesterday'])
    expect(result[0].sessions.map((s) => s.id)).toEqual(['dst-yesterday'])
  })
})
