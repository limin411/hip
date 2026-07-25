import { describe, expect, it } from 'vitest'
import {
  filterItems,
  localTodayYmd,
  matchesFilter,
  matchesSearch,
} from './filter'
import type { WorkItem, WorkItemStatus } from './types'

function wi(
  partial: Partial<WorkItem> & Pick<WorkItem, 'id' | 'status'>,
): WorkItem {
  return {
    title: partial.title ?? partial.id,
    priority: 'none',
    listId: 'wl_inbox',
    tags: [],
    notes: '',
    startOn: null,
    endOn: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    archivedAt: null,
    links: {},
    ...partial,
  }
}

const today = '2026-07-25'

const samples: WorkItem[] = [
  wi({ id: 'wi_todo', status: 'todo', startOn: null, endOn: today }),
  wi({ id: 'wi_ip', status: 'in_progress', startOn: null, endOn: '2026-07-20' }),
  wi({ id: 'wi_done', status: 'done', completedAt: 1 }),
  wi({ id: 'wi_cancel', status: 'cancelled', completedAt: 1 }),
  wi({
    id: 'wi_arch',
    status: 'todo',
    archivedAt: 2,
    startOn: null,
    endOn: today,
  }),
  wi({
    id: 'wi_list_a',
    status: 'done',
    listId: 'wl_a',
    completedAt: 1,
  }),
  wi({
    id: 'wi_overdue_arch',
    status: 'todo',
    startOn: null,
    endOn: '2026-01-01',
    archivedAt: 9,
  }),
]

function ids(filterId: string, search = ''): string[] {
  return filterItems(samples, filterId, today, search).map((i) => i.id)
}

describe('matchesFilter', () => {
  it('all: non-archived items of any status', () => {
    expect(ids('all').sort()).toEqual(
      ['wi_todo', 'wi_ip', 'wi_done', 'wi_cancel', 'wi_list_a'].sort(),
    )
    expect(ids('all')).not.toContain('wi_arch')
    expect(ids('all')).not.toContain('wi_overdue_arch')
  })

  it('todo: non-archived status todo only', () => {
    expect(ids('todo')).toEqual(['wi_todo'])
    expect(ids('todo')).not.toContain('wi_ip')
  })

  it('in_progress: non-archived in_progress only', () => {
    expect(ids('in_progress')).toEqual(['wi_ip'])
  })

  it('done excludes cancelled and archived', () => {
    expect(ids('done').sort()).toEqual(['wi_done', 'wi_list_a'].sort())
    expect(ids('done')).not.toContain('wi_cancel')
    expect(ids('done')).not.toContain('wi_arch')
  })

  it('archived: any status with archivedAt', () => {
    expect(ids('archived').sort()).toEqual(['wi_arch', 'wi_overdue_arch'].sort())
  })

  it('list: matches listId and excludes archived', () => {
    expect(ids('list:wl_a')).toEqual(['wi_list_a'])
    expect(ids('list:wl_inbox').sort()).toEqual(
      ['wi_todo', 'wi_ip', 'wi_done', 'wi_cancel'].sort(),
    )
    // archived on inbox not included
    expect(ids('list:wl_inbox')).not.toContain('wi_arch')
  })

  it('unknown filterId matches nothing', () => {
    expect(ids('nope')).toEqual([])
  })

  it('archived todo excluded from todo filter', () => {
    expect(matchesFilter(samples.find((i) => i.id === 'wi_arch')!, 'todo', today)).toBe(
      false,
    )
  })
})

describe('matchesSearch', () => {
  const base = wi({
    id: 'wi_s',
    status: 'todo',
    title: 'Ship Feature',
    notes: 'Needs review of API',
    tags: ['Backend', 'urgent'],
  })

  it('matches title case-insensitively', () => {
    expect(matchesSearch(base, 'ship')).toBe(true)
    expect(matchesSearch(base, 'FEATURE')).toBe(true)
  })

  it('matches notes', () => {
    expect(matchesSearch(base, 'api')).toBe(true)
  })

  it('matches tags', () => {
    expect(matchesSearch(base, 'backend')).toBe(true)
    expect(matchesSearch(base, 'URGENT')).toBe(true)
  })

  it('empty query matches all', () => {
    expect(matchesSearch(base, '')).toBe(true)
    expect(matchesSearch(base, '   ')).toBe(true)
  })

  it('non-match returns false', () => {
    expect(matchesSearch(base, 'zzz')).toBe(false)
  })
})

describe('filterItems search AND filter', () => {
  it('combines filter with search', () => {
    const items = [
      wi({ id: 'wi_1', status: 'todo', title: 'Alpha' }),
      wi({ id: 'wi_2', status: 'todo', title: 'Beta' }),
      wi({ id: 'wi_3', status: 'done', title: 'Alpha done', completedAt: 1 }),
    ]
    const out = filterItems(items, 'todo', today, 'alpha')
    expect(out.map((i) => i.id)).toEqual(['wi_1'])
  })
})

describe('localTodayYmd', () => {
  it('formats local calendar date as YYYY-MM-DD', () => {
    const d = new Date(2026, 6, 25) // July is month 6
    expect(localTodayYmd(d)).toBe('2026-07-25')
  })
})

describe('done vs cancelled matrix', () => {
  const statuses: WorkItemStatus[] = ['done', 'cancelled']
  for (const status of statuses) {
    it(`${status} appears in all; only done has its own smart filter`, () => {
      const item = wi({
        id: `wi_${status}`,
        status,
        completedAt: 1,
      })
      expect(matchesFilter(item, 'todo', today)).toBe(false)
      expect(matchesFilter(item, 'all', today)).toBe(true)
      expect(matchesFilter(item, 'done', today)).toBe(status === 'done')
    })
  }
})
