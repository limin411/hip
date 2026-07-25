import { PRIORITY_RANK } from './priority'
import type { WorkItem } from './types'

/**
 * Default sort: dueOn asc (null last) → PRIORITY_RANK desc → updatedAt desc → id asc.
 */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  // dueOn asc, null last
  if (a.dueOn == null && b.dueOn != null) return 1
  if (a.dueOn != null && b.dueOn == null) return -1
  if (a.dueOn != null && b.dueOn != null && a.dueOn !== b.dueOn) {
    return a.dueOn < b.dueOn ? -1 : 1
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
