import { matchesFilter } from './filter'
import { sortWorkItems } from './sort'
import type { WorkItem } from './types'

/** Pure workbench selectors — no zustand. Sorted with default item order. */

export function selectAllItems(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'all')))
}

/** Non-archived todo (待处理). */
export function selectTodoItems(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'todo')))
}

export function selectInProgress(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'in_progress')))
}

export function selectDone(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'done')))
}

export function selectArchived(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'archived')))
}
