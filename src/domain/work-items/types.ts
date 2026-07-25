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
  /** Local calendar date YYYY-MM-DD, or null. No time-of-day. NEVER dueAt. */
  dueOn: string | null
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
