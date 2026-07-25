import type { WorkItem, WorkItemStatus } from './types'

const TERMINAL: ReadonlySet<WorkItemStatus> = new Set(['done', 'cancelled'])

/** Allowed status transitions (same-status is never allowed). */
const ALLOWED: Record<WorkItemStatus, ReadonlySet<WorkItemStatus>> = {
  todo: new Set(['in_progress', 'done', 'cancelled']),
  in_progress: new Set(['todo', 'done', 'cancelled']),
  done: new Set(['todo', 'in_progress', 'cancelled']),
  cancelled: new Set(['todo', 'in_progress', 'done']),
}

export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  if (from === to) return false
  return ALLOWED[from].has(to)
}

/**
 * Apply a status change with completedAt side effects (destination-based).
 * - enter done|cancelled → completedAt = now
 * - enter todo|in_progress → completedAt = null (always; upholds open invariant)
 * Returns `item` unchanged when transition is not allowed.
 */
export function applyStatus(item: WorkItem, to: WorkItemStatus, now: number): WorkItem {
  if (!canTransition(item.status, to)) return item

  return {
    ...item,
    status: to,
    completedAt: TERMINAL.has(to) ? now : null,
    updatedAt: now,
  }
}
