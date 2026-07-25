import { matchesFilter } from './filter'
import { sortWorkItems } from './sort'
import type { WorkItem } from './types'

/** Pure workbench selectors — no zustand. Sorted with default item order. */

export function selectOpenItems(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'open')))
}

export function selectTodayDue(
  items: readonly WorkItem[],
  todayYmd: string,
): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'today', todayYmd)))
}

export function selectOverdue(
  items: readonly WorkItem[],
  todayYmd: string,
): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'overdue', todayYmd)))
}

export function selectInProgress(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'in_progress')))
}

/** Non-archived cancelled items (K17). */
export function selectCancelled(items: readonly WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((i) => matchesFilter(i, 'cancelled')))
}
