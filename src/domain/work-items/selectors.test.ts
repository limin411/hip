import { describe, expect, it } from 'vitest'
import {
  selectCancelled,
  selectInProgress,
  selectOpenItems,
  selectOverdue,
  selectTodayDue,
} from './selectors'
import type { WorkItem } from './types'

function wi(
  partial: Partial<WorkItem> & Pick<WorkItem, 'id' | 'status'>,
): WorkItem {
  return {
    title: partial.id,
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

const today = '2026-07-25'

const items: WorkItem[] = [
  wi({ id: 'wi_todo_late', status: 'todo', dueOn: '2026-07-20', priority: 'low' }),
  wi({ id: 'wi_todo_today', status: 'todo', dueOn: today, priority: 'high' }),
  wi({ id: 'wi_ip', status: 'in_progress', dueOn: today, priority: 'medium' }),
  wi({ id: 'wi_done', status: 'done', completedAt: 1 }),
  wi({ id: 'wi_cancel', status: 'cancelled', completedAt: 1 }),
  wi({ id: 'wi_arch_cancel', status: 'cancelled', completedAt: 1, archivedAt: 2 }),
]

describe('selectors', () => {
  it('selectOpenItems returns todo + in_progress, sorted', () => {
    const out = selectOpenItems(items)
    expect(out.map((i) => i.id)).toEqual([
      'wi_todo_late',
      'wi_todo_today',
      'wi_ip',
    ])
  })

  it('selectTodayDue', () => {
    expect(selectTodayDue(items, today).map((i) => i.id)).toEqual([
      'wi_todo_today',
      'wi_ip',
    ])
  })

  it('selectOverdue', () => {
    expect(selectOverdue(items, today).map((i) => i.id)).toEqual(['wi_todo_late'])
  })

  it('selectInProgress', () => {
    expect(selectInProgress(items).map((i) => i.id)).toEqual(['wi_ip'])
  })

  it('selectCancelled excludes archived and done', () => {
    expect(selectCancelled(items).map((i) => i.id)).toEqual(['wi_cancel'])
  })
})
