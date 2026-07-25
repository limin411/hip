import { describe, expect, it } from 'vitest'
import {
  selectAllItems,
  selectArchived,
  selectDone,
  selectInProgress,
  selectTodoItems,
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

const items: WorkItem[] = [
  wi({ id: 'wi_todo_late', status: 'todo', startOn: null, endOn: '2026-07-20', priority: 'low' }),
  wi({ id: 'wi_todo_today', status: 'todo', startOn: null, endOn: today, priority: 'high' }),
  wi({ id: 'wi_ip', status: 'in_progress', startOn: null, endOn: today, priority: 'medium' }),
  wi({ id: 'wi_done', status: 'done', completedAt: 1 }),
  wi({ id: 'wi_cancel', status: 'cancelled', completedAt: 1 }),
  wi({ id: 'wi_arch_cancel', status: 'cancelled', completedAt: 1, archivedAt: 2 }),
]

describe('selectors', () => {
  it('selectAllItems returns non-archived of any status', () => {
    // schedule first (late, today, ip), then null schedule by id asc (cancel before done)
    expect(selectAllItems(items).map((i) => i.id)).toEqual([
      'wi_todo_late',
      'wi_todo_today',
      'wi_ip',
      'wi_cancel',
      'wi_done',
    ])
  })

  it('selectTodoItems returns non-archived todo only', () => {
    expect(selectTodoItems(items).map((i) => i.id)).toEqual([
      'wi_todo_late',
      'wi_todo_today',
    ])
  })

  it('selectInProgress', () => {
    expect(selectInProgress(items).map((i) => i.id)).toEqual(['wi_ip'])
  })

  it('selectDone excludes cancelled and archived', () => {
    expect(selectDone(items).map((i) => i.id)).toEqual(['wi_done'])
  })

  it('selectArchived', () => {
    expect(selectArchived(items).map((i) => i.id)).toEqual(['wi_arch_cancel'])
  })
})
