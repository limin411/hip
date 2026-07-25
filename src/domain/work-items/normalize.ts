import { INBOX_LIST_ID, isWorkItemId, isWorkListId } from './ids'
import type {
  WorkItem,
  WorkItemLinks,
  WorkItemList,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemsCatalogV1,
} from './types'

/** Title max length (chars). */
export const WORK_ITEM_TITLE_MAX = 200

/** Notes max length (chars) — 64 KiB. */
export const WORK_ITEM_NOTES_MAX = 64 * 1024

/** Max tags per item. */
export const WORK_ITEM_TAGS_MAX = 20

/** Max chars per tag. */
export const WORK_ITEM_TAG_MAX_LEN = 32

/** dueOn shape: YYYY-MM-DD. */
export const DUE_ON_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * True when `s` is YYYY-MM-DD and a real local calendar day
 * (rejects `2026-02-31`, `2026-13-01`, etc.).
 */
export function isValidDueOn(s: string): boolean {
  if (!DUE_ON_RE.test(s)) return false
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const dt = new Date(y, m - 1, d)
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  )
}

const STATUSES: ReadonlySet<string> = new Set([
  'todo',
  'in_progress',
  'done',
  'cancelled',
])
const PRIORITIES: ReadonlySet<string> = new Set(['none', 'low', 'medium', 'high'])

function inboxList(now: number): WorkItemList {
  return {
    id: INBOX_LIST_ID,
    name: 'Inbox',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    system: 'inbox',
  }
}

/** Empty catalog with system Inbox only. */
export function emptyDefaultCatalog(now: number = Date.now()): WorkItemsCatalogV1 {
  return {
    version: 1,
    lists: [inboxList(now)],
    items: [],
  }
}

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max)
}

function asFiniteNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const trimmed = t.trim()
    if (!trimmed) continue
    const tag = clampStr(trimmed, WORK_ITEM_TAG_MAX_LEN)
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= WORK_ITEM_TAGS_MAX) break
  }
  return out
}

function normalizeLinks(raw: unknown): WorkItemLinks {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const links: WorkItemLinks = {}

  if (typeof o.sessionId === 'string' && o.sessionId.trim()) {
    links.sessionId = o.sessionId.trim()
  }

  if (o.knowledge && typeof o.knowledge === 'object') {
    const k = o.knowledge as Record<string, unknown>
    const spaceId = typeof k.spaceId === 'string' ? k.spaceId.trim() : ''
    const docId = typeof k.docId === 'string' ? k.docId.trim() : ''
    if (spaceId && docId) {
      links.knowledge = { spaceId, docId }
    }
  }

  if (typeof o.url === 'string' && o.url.trim()) {
    links.url = o.url.trim()
  }

  return links
}

function normalizeDueOn(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!isValidDueOn(s)) return null
  return s
}

function normalizeStatus(raw: unknown): WorkItemStatus {
  if (typeof raw === 'string' && STATUSES.has(raw)) return raw as WorkItemStatus
  return 'todo'
}

function normalizePriority(raw: unknown): WorkItemPriority {
  if (typeof raw === 'string' && PRIORITIES.has(raw)) return raw as WorkItemPriority
  return 'none'
}

function normalizeList(
  raw: unknown,
  fallbackNow: number,
): WorkItemList | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!isWorkListId(id)) return null

  const nameRaw = typeof o.name === 'string' ? o.name : id === INBOX_LIST_ID ? 'Inbox' : ''
  const name = clampStr(nameRaw.trim() || (id === INBOX_LIST_ID ? 'Inbox' : 'List'), 200)
  const createdAt = asFiniteNumber(o.createdAt, fallbackNow)
  const updatedAt = asFiniteNumber(o.updatedAt, createdAt)
  const sortOrder = asFiniteNumber(o.sortOrder, 0)

  const list: WorkItemList = {
    id,
    name,
    sortOrder,
    createdAt,
    updatedAt,
  }
  // Only the real Inbox id may carry system:'inbox' (strip forged flags).
  if (id === INBOX_LIST_ID) {
    list.system = 'inbox'
  }
  return list
}

function normalizeItem(
  raw: unknown,
  listIds: ReadonlySet<string>,
  fallbackNow: number,
): WorkItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!isWorkItemId(id)) return null

  const status = normalizeStatus(o.status)
  const priority = normalizePriority(o.priority)
  let listId = typeof o.listId === 'string' ? o.listId.trim() : INBOX_LIST_ID
  if (!listIds.has(listId)) listId = INBOX_LIST_ID

  const title =
    typeof o.title === 'string'
      ? clampStr(o.title.trim(), WORK_ITEM_TITLE_MAX)
      : ''
  const notes =
    typeof o.notes === 'string' ? clampStr(o.notes, WORK_ITEM_NOTES_MAX) : ''
  const tags = normalizeTags(o.tags)
  const dueOn = normalizeDueOn(o.dueOn)
  const createdAt = asFiniteNumber(o.createdAt, fallbackNow)
  const updatedAt = asFiniteNumber(o.updatedAt, createdAt)
  const links = normalizeLinks(o.links)

  let completedAt: number | null =
    o.completedAt == null ? null : asFiniteNumber(o.completedAt, NaN)
  if (completedAt != null && !Number.isFinite(completedAt)) completedAt = null

  // Invariant: open ⇒ completedAt null; terminal ⇒ completedAt set
  if (status === 'todo' || status === 'in_progress') {
    completedAt = null
  } else if (completedAt == null) {
    completedAt = updatedAt
  }

  let archivedAt: number | null =
    o.archivedAt == null ? null : asFiniteNumber(o.archivedAt, NaN)
  if (archivedAt != null && !Number.isFinite(archivedAt)) archivedAt = null

  return {
    id,
    title,
    status,
    priority,
    listId,
    tags,
    notes,
    dueOn,
    createdAt,
    updatedAt,
    completedAt,
    archivedAt,
    links,
  }
}

/**
 * Coerce unknown disk/IPC payload into a valid catalog.
 * Ensures Inbox list, drops invalid items, clamps strings, rehomes bad listId → inbox.
 */
export function normalizeCatalog(raw: unknown): WorkItemsCatalogV1 {
  const now = Date.now()

  if (!raw || typeof raw !== 'object') {
    return emptyDefaultCatalog(now)
  }

  const o = raw as Record<string, unknown>
  const listsIn = Array.isArray(o.lists) ? o.lists : []
  const itemsIn = Array.isArray(o.items) ? o.items : []

  const lists: WorkItemList[] = []
  const seenListIds = new Set<string>()

  for (const entry of listsIn) {
    const list = normalizeList(entry, now)
    if (!list || seenListIds.has(list.id)) continue
    seenListIds.add(list.id)
    lists.push(list)
  }

  // Ensure Inbox present with system flag
  const inboxIdx = lists.findIndex((l) => l.id === INBOX_LIST_ID)
  if (inboxIdx < 0) {
    lists.unshift(inboxList(now))
  } else {
    const existing = lists[inboxIdx]!
    lists[inboxIdx] = {
      ...existing,
      system: 'inbox',
      name: existing.name.trim() || 'Inbox',
    }
  }

  // Stable list order by sortOrder then id
  lists.sort((a, b) => {
    if (a.id === INBOX_LIST_ID) return -1
    if (b.id === INBOX_LIST_ID) return 1
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const listIds = new Set(lists.map((l) => l.id))
  const items: WorkItem[] = []
  const seenItemIds = new Set<string>()

  for (const entry of itemsIn) {
    const item = normalizeItem(entry, listIds, now)
    if (!item || seenItemIds.has(item.id)) continue
    seenItemIds.add(item.id)
    items.push(item)
  }

  return { version: 1, lists, items }
}
