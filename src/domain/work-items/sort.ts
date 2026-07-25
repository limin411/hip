import { PRIORITY_RANK } from './priority'
import type { WorkItem } from './types'

/** Sort key for schedule: start first, else end (null = no schedule). */
function scheduleSortKey(item: WorkItem): string | null {
  return item.startOn ?? item.endOn
}

/**
 * Default sort: schedule start/end asc (null last) → PRIORITY_RANK desc → updatedAt desc → id asc.
 */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  const aKey = scheduleSortKey(a)
  const bKey = scheduleSortKey(b)
  // schedule asc, null last
  if (aKey == null && bKey != null) return 1
  if (aKey != null && bKey == null) return -1
  if (aKey != null && bKey != null && aKey !== bKey) {
    return aKey < bKey ? -1 : 1
  }
  // Same primary key: prefer earlier endOn when both have it
  if (a.endOn != null && b.endOn != null && a.endOn !== b.endOn) {
    return a.endOn < b.endOn ? -1 : 1
  }

  const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
  if (pr !== 0) return pr

  if (a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt
  }

  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/** Stable copy sorted by {@link compareWorkItems}. */
export function sortWorkItems(items: readonly WorkItem[]): WorkItem[] {
  return [...items].sort(compareWorkItems)
}
