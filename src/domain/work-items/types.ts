/** Product work item — NOT TaskRuntime / write_todos. */

export type WorkItemStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type WorkItemPriority = 'none' | 'low' | 'medium' | 'high'

export type WorkItemLinks = {
  sessionId?: string
  knowledge?: { spaceId: string; docId: string }
  url?: string
}

export type WorkItem = {
  id: string
  title: string
  status: WorkItemStatus
  priority: WorkItemPriority
  listId: string
  tags: string[]
  notes: string
  /**
   * Schedule range as local calendar dates `YYYY-MM-DD` (always present after normalize).
   * No time-of-day. Invariant: `startOn <= endOn`.
   * Disk may still omit dates; load/normalize fills with local today.
   * Legacy single-day `dueOn` is migrated to `endOn` on load (see normalize).
   */
  startOn: string
  endOn: string
  createdAt: number
  updatedAt: number
  /** Set when entering done or cancelled; null when open. */
  completedAt: number | null
  archivedAt: number | null
  links: WorkItemLinks
  // v1: NO sortOrder on items
}

export type WorkItemList = {
  id: string
  name: string
  sortOrder: number
  createdAt: number
  updatedAt: number
  system?: 'inbox'
}

/** v1 on-disk / IPC catalog: full items including notes (single file). */
export type WorkItemsCatalogV1 = {
  version: 1
  lists: WorkItemList[]
  items: WorkItem[]
}
