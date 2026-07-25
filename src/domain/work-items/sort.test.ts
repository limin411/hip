import { describe, expect, it } from 'vitest'
import { PRIORITY_RANK } from './priority'
import { compareWorkItems, sortWorkItems } from './sort'
import type { WorkItem, WorkItemPriority } from './types'

function wi(partial: Partial<WorkItem> & Pick<WorkItem, 'id'>): WorkItem {
  return {
    title: partial.id,
    status: 'todo',
    priority: 'none',
    listId: 'wl_inbox',
    tags: [],
    notes: '',
    dueOn: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    archivedAt: null,
    links: {},
    ...partial,
  }
}

describe('PRIORITY_RANK', () => {
  it('orders high > medium > low > none', () => {
    expect(PRIORITY_RANK.high).toBe(3)
    expect(PRIORITY_RANK.medium).toBe(2)
    expect(PRIORITY_RANK.low).toBe(1)
    expect(PRIORITY_RANK.none).toBe(0)
  })
})

describe('sortWorkItems', () => {
  it('sorts dueOn ascending with null last', () => {
    const items = [
      wi({ id: 'wi_c', dueOn: '2026-07-20' }),
      wi({ id: 'wi_a', dueOn: null }),
      wi({ id: 'wi_b', dueOn: '2026-07-10' }),
    ]
    expect(sortWorkItems(items).map((i) => i.id)).toEqual([
      'wi_b',
      'wi_c',
      'wi_a',
    ])
  })

  it('breaks dueOn ties by priority desc', () => {
    const prios: WorkItemPriority[] = ['none', 'high', 'low', 'medium']
    const items = prios.map((priority, i) =>
      wi({ id: `wi_${i}`, dueOn: '2026-07-01', priority }),
    )
    expect(sortWorkItems(items).map((i) => i.priority)).toEqual([
      'high',
      'medium',
      'low',
      'none',
    ])
  })

  it('breaks priority ties by updatedAt desc', () => {
    const items = [
      wi({ id: 'wi_old', dueOn: '2026-07-01', priority: 'high', updatedAt: 10 }),
      wi({ id: 'wi_new', dueOn: '2026-07-01', priority: 'high', updatedAt: 99 }),
    ]
    expect(sortWorkItems(items).map((i) => i.id)).toEqual(['wi_new', 'wi_old'])
  })

  it('breaks remaining ties by id asc', () => {
    const items = [
      wi({ id: 'wi_b', dueOn: '2026-07-01', priority: 'high', updatedAt: 5 }),
      wi({ id: 'wi_a', dueOn: '2026-07-01', priority: 'high', updatedAt: 5 }),
    ]
    expect(sortWorkItems(items).map((i) => i.id)).toEqual(['wi_a', 'wi_b'])
  })

  it('does not mutate input', () => {
    const items = [wi({ id: 'wi_2', dueOn: '2026-07-02' }), wi({ id: 'wi_1', dueOn: '2026-07-01' })]
    const copy = [...items]
    sortWorkItems(items)
    expect(items).toEqual(copy)
  })

  it('compareWorkItems is antisymmetric for distinct ids', () => {
    const a = wi({ id: 'wi_a', dueOn: '2026-01-01' })
    const b = wi({ id: 'wi_b', dueOn: '2026-02-01' })
    expect(Math.sign(compareWorkItems(a, b))).toBe(
      -Math.sign(compareWorkItems(b, a)),
    )
  })
})
