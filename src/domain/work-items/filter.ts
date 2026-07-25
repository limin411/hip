import type { WorkItem, WorkItemStatus } from './types'

export type SmartFilterId =
  | 'all'
  | 'todo'
  | 'in_progress'
  | 'done'
  | 'archived'

/** Smart filter ids or legacy `list:${listId}` (list UI removed; still matches catalog). */
export type WorkItemFilterId = SmartFilterId | `list:${string}`

/**
 * Default create status from the active sidebar smart filter.
 * Status filters map 1:1; `all` / `archived` / lists fall back to `todo`
 * (archived is not a WorkItemStatus — it is `archivedAt`).
 */
export function defaultStatusFromFilter(filterId: string): WorkItemStatus {
  if (filterId === 'todo' || filterId === 'in_progress' || filterId === 'done') {
    return filterId
  }
  return 'todo'
}

/** Local calendar day as `YYYY-MM-DD` (system local TZ). */
export function localTodayYmd(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Predicate for a single filterId (no search).
 * `todayYmd` is unused by current smart filters; kept for call-site compatibility.
 */
export function matchesFilter(
  item: WorkItem,
  filterId: string,
  _todayYmd?: string,
): boolean {
  if (filterId.startsWith('list:')) {
    const listId = filterId.slice('list:'.length)
    return item.listId === listId && item.archivedAt == null
  }

  switch (filterId as SmartFilterId) {
    case 'all':
      // All non-archived items (any status). Use `archived` for archived.
      return item.archivedAt == null
    case 'todo':
      return item.archivedAt == null && item.status === 'todo'
    case 'in_progress':
      return item.archivedAt == null && item.status === 'in_progress'
    case 'done':
      // done only — NOT cancelled
      return item.archivedAt == null && item.status === 'done'
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
