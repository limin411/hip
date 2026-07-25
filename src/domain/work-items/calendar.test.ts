import { describe, expect, it } from 'vitest'
import { buildMonthMatrix, daysBetweenYmd, placeBarsForMonth, ymdFromParts } from './calendar'
import type { WorkItem } from './types'

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    id: partial.id,
    title: partial.title ?? 't',
    status: partial.status ?? 'todo',
    priority: partial.priority ?? 'none',
    listId: partial.listId ?? 'wl_inbox',
    tags: partial.tags ?? [],
    notes: partial.notes ?? '',
    startOn: partial.startOn ?? null,
    endOn: partial.endOn ?? null,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    completedAt: partial.completedAt ?? null,
    archivedAt: partial.archivedAt ?? null,
    links: partial.links ?? {},
  }
}

describe('buildMonthMatrix', () => {
  it('is Sunday-first and has 42 cells for July 2026', () => {
    // July 2026: 1st is Wednesday
    const cells = buildMonthMatrix(2026, 6)
    expect(cells.length).toBe(42)
    expect(cells[0]!.out).toBe(true) // pad
    const firstIn = cells.find((c) => !c.out)!
    expect(firstIn.ymd).toBe('2026-07-01')
    // First cell is Sunday June 28
    expect(cells[0]!.ymd).toBe('2026-06-28')
  })
})

describe('daysBetweenYmd', () => {
  it('counts inclusive span endpoints distance', () => {
    expect(daysBetweenYmd('2026-07-20', '2026-07-28')).toBe(8)
  })
})

describe('placeBarsForMonth', () => {
  it('emits start/mid/end for multi-day items', () => {
    const items = [
      wi({
        id: 'wi_a',
        title: 'Span',
        startOn: '2026-07-22',
        endOn: '2026-07-24',
      }),
    ]
    const map = placeBarsForMonth(items, 2026, 6, '2026-07-25')
    expect(map.get('2026-07-22')?.[0]).toMatchObject({ kind: 'start', itemId: 'wi_a' })
    expect(map.get('2026-07-23')?.[0]).toMatchObject({ kind: 'mid' })
    expect(map.get('2026-07-24')?.[0]).toMatchObject({ kind: 'end' })
  })

  it('fills missing dates with today for single day', () => {
    const items = [wi({ id: 'wi_b', title: 'No dates', startOn: null, endOn: null })]
    const map = placeBarsForMonth(items, 2026, 6, '2026-07-25')
    expect(map.get('2026-07-25')?.[0]?.kind).toBe('single')
  })

  it('uses archived color key when archivedAt set', () => {
    const items = [
      wi({
        id: 'wi_c',
        status: 'todo',
        archivedAt: 99,
        startOn: '2026-07-10',
        endOn: '2026-07-10',
      }),
    ]
    const map = placeBarsForMonth(items, 2026, 6, '2026-07-25')
    expect(map.get('2026-07-10')?.[0]?.colorKey).toBe('archived')
  })
})

describe('ymdFromParts', () => {
  it('pads month and day', () => {
    expect(ymdFromParts(2026, 0, 5)).toBe('2026-01-05')
  })
})
