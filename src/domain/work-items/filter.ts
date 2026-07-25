import type { WorkItem, WorkItemStatus } from './types'

export type SmartFilterId =
  | 'open'
  | 'today'
  | 'overdue'
  | 'in_progress'
  | 'done'
  | 'cancelled'
  | 'archived'

/** Smart filter ids or `list:${listId}`. */
export type WorkItemFilterId = SmartFilterId | `list:${string}`

const OPEN_STATUSES: ReadonlySet<WorkItemStatus> = new Set(['todo', 'in_progress'])

/** Local calendar day as `YYYY-MM-DD` (system local TZ). */
export function localTodayYmd(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isOpen(item: WorkItem): boolean {
  return item.archivedAt == null && OPEN_STATUSES.has(item.status)
}

/**
 * Predicate for a single filterId (no search).
 * `todayYmd` is only required for `today` / `overdue`; omitted → `localTodayYmd()`.
 */
export function matchesFilter(
  item: WorkItem,
  filterId: string,
  todayYmd?: string,
): boolean {
  if (filterId.startsWith('list:')) {
    const listId = filterId.slice('list:'.length)
    return item.listId === listId && item.archivedAt == null
  }

  switch (filterId as SmartFilterId) {
    case 'open':
      return isOpen(item)
    case 'today': {
      const day = todayYmd ?? localTodayYmd()
      return isOpen(item) && item.dueOn === day
    }
    case 'overdue': {
      const day = todayYmd ?? localTodayYmd()
      return isOpen(item) && item.dueOn != null && item.dueOn < day
    }
    case 'in_progress':
      return isOpen(item) && item.status === 'in_progress'
    case 'done':
      // done only — NOT cancelled (K17)
      return item.archivedAt == null && item.status === 'done'
    case 'cancelled':
      return item.archivedAt == null && item.status === 'cancelled'
    case 'archived':
      return item.archivedAt != null
    default:
      return false
  }
}

/**
 * Case-insensitive match against title, notes, and tags.
 * Empty / whitespace-only query matches everything.
 */
export function matchesSearch(item: WorkItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (item.title.toLowerCase().includes(q)) return true
  if (item.notes.toLowerCase().includes(q)) return true
  return item.tags.some((t) => t.toLowerCase().includes(q))
}

/** Filter items by filterId AND optional search query. */
export function filterItems(
  items: readonly WorkItem[],
  filterId: string,
  todayYmd: string,
  search = '',
): WorkItem[] {
  return items.filter(
    (item) => matchesFilter(item, filterId, todayYmd) && matchesSearch(item, search),
  )
}
