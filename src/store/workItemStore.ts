import { create } from 'zustand'
import {
  applyStatus,
  ensureScheduleDates,
  INBOX_LIST_ID,
  isDefaultScheduleOnly,
  localTodayYmd,
  mintWorkItemId,
  mintWorkListId,
  type WorkItem,
  type WorkItemList,
  type WorkItemStatus,
  type WorkItemsCatalogV1,
} from '@/domain/work-items'
import {
  listWorkItems,
  listWorkItemsTrash,
  saveWorkItems,
  softDeleteWorkItem,
  restoreWorkItemTrashEntry,
} from '@/ipc/workItems'

/** English fallback for empty-title items that still have extras (i18n in UI later). */
export const UNTITLED_WORK_ITEM = 'Untitled'

const NOTES_DEBOUNCE_MS = 300
const HTTP_URL_RE = /^https?:\/\//i

function toCatalog(s: { lists: WorkItemList[]; items: WorkItem[] }): WorkItemsCatalogV1 {
  return {
    version: 1,
    lists: s.lists,
    items: s.items,
  }
}

/**
 * Serialize catalog IPC writes so concurrent mutations cannot clobber each other.
 * Each `save` snapshots Zustand state when its turn runs (latest wins).
 */
let saveChain: Promise<void> = Promise.resolve()

function enqueueSave(run: () => Promise<void>): Promise<void> {
  const next = saveChain.then(run, run)
  saveChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** Pending notes for debounce (module-level so finalize can see unsaved text). */
let notesDraft: { id: string; notes: string } | null = null
let notesDebounceTimer: ReturnType<typeof setTimeout> | null = null

function clearNotesDebounceTimer(): void {
  if (notesDebounceTimer != null) {
    clearTimeout(notesDebounceTimer)
    notesDebounceTimer = null
  }
}

function pendingNotesFor(id: string, itemNotes: string): string {
  if (notesDraft?.id === id) return notesDraft.notes
  return itemNotes
}

/**
 * User-meaningful content beyond empty title + pure default schedule (today–today).
 * Default create dates alone must not block empty-shell discard.
 */
function hasExtras(item: WorkItem, notes: string, todayYmd: string = localTodayYmd()): boolean {
  if (notes.trim() !== '') return true
  if (item.tags.length > 0) return true
  if (item.links.sessionId || item.links.knowledge || item.links.url) return true
  if (item.startOn != null || item.endOn != null) {
    if (!isDefaultScheduleOnly(item.startOn, item.endOn, todayYmd)) return true
  }
  return false
}

function sanitizeLinksPatch(links: WorkItem['links']): WorkItem['links'] {
  if (links.url == null || links.url === '') {
    const { url: _drop, ...rest } = links
    return rest
  }
  if (!HTTP_URL_RE.test(links.url)) {
    const { url: _drop, ...rest } = links
    return rest
  }
  return links
}

function listIdFromFilter(filterId: string, lists: WorkItemList[]): string {
  if (filterId.startsWith('list:')) {
    const id = filterId.slice('list:'.length)
    if (lists.some((l) => l.id === id)) return id
  }
  return INBOX_LIST_ID
}

function defaultItem(
  now: number,
  listId: string,
  partial?: Partial<WorkItem>,
  todayYmd: string = localTodayYmd(),
): WorkItem {
  const schedule = ensureScheduleDates(
    {
      startOn: partial?.startOn,
      endOn: partial?.endOn,
    },
    todayYmd,
  )
  const base: WorkItem = {
    id: mintWorkItemId(),
    title: '',
    status: 'todo',
    priority: 'none',
    listId,
    tags: [],
    notes: '',
    startOn: schedule.startOn,
    endOn: schedule.endOn,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null,
    links: {},
  }
  if (!partial) return base
  const merged: WorkItem = {
    ...base,
    ...partial,
    id: partial.id && partial.id.startsWith('wi_') ? partial.id : base.id,
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    startOn: schedule.startOn,
    endOn: schedule.endOn,
    links: partial.links ? sanitizeLinksPatch(partial.links) : base.links,
  }
  // Re-ensure if partial overwrote with null before we forced schedule.
  const ensured = ensureScheduleDates(merged, todayYmd)
  merged.startOn = ensured.startOn
  merged.endOn = ensured.endOn
  // Uphold completedAt invariant for open vs terminal.
  if (merged.status === 'todo' || merged.status === 'in_progress') {
    merged.completedAt = null
  } else if (merged.completedAt == null) {
    merged.completedAt = now
  }
  return merged
}

export interface WorkItemStore {
  loaded: boolean
  loading: boolean
  error: string | null
  lists: WorkItemList[]
  items: WorkItem[]
  /** Smart filter or legacy `list:${id}`; default `all` (calendar-first cutover). */
  filterId: string
  search: string
  selectedId: string | null

  load: () => Promise<void>
  /** Enqueue save of current lists+items snapshot. */
  save: () => Promise<void>
  /** finalizeSelectedItem + cancel notes debounce + await saveChain. */
  flushSave: () => Promise<void>
  /**
   * Empty-title policy before deselect / leave / flush.
   * Empty title + no extras → discard; empty + extras → `UNTITLED_WORK_ITEM`.
   */
  finalizeSelectedItem: () => void

  /**
   * Persist a new work item (dates always ensured).
   * @param options.select default false (no master-detail).
   */
  createItem: (
    partial?: Partial<WorkItem>,
    options?: { select?: boolean },
  ) => Promise<string>
  updateItem: (id: string, patch: Partial<WorkItem>) => Promise<void>
  /**
   * Atomic multi-field edit used by the editor modal (one save).
   * Always ensures schedule dates; empty title is rejected by the modal.
   */
  commitItemDraft: (
    id: string | null,
    draft: {
      title: string
      startOn: string
      endOn: string
      status: WorkItemStatus
      priority: WorkItem['priority']
      notes: string
      tags: string[]
    },
  ) => Promise<string>
  /** Finalize previous selection, then set selectedId. */
  select: (id: string | null) => void

  setStatus: (id: string, status: WorkItemStatus) => Promise<void>
  complete: (id: string) => Promise<void>
  reopen: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  archive: (id: string) => Promise<void>
  unarchive: (id: string) => Promise<void>
  /**
   * Soft-delete into product recycle bin (`trash/work-items`).
   * Live catalog is updated by the Tauri command (not `save()`).
   */
  deleteItem: (id: string) => Promise<void>
  /** Restore a recycle-bin entry and reload it into the live store. */
  restoreTrashEntry: (entryId: string) => Promise<string>

  createList: (name: string) => Promise<string>
  renameList: (id: string, name: string) => Promise<void>
  /** Migrate items to Inbox, then remove list (Inbox is not deletable). */
  deleteList: (id: string) => Promise<void>

  setFilter: (filterId: string) => void
  setSearch: (search: string) => void

  /**
   * Local notes draft with 300ms debounce → updateItem + save.
   * Call `commitNotesDraft` on blur to flush immediately.
   */
  setNotesDraft: (id: string, notes: string) => void
  commitNotesDraft: () => void
}

export const useWorkItemStore = create<WorkItemStore>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  lists: [],
  items: [],
  filterId: 'all',
  search: '',
  selectedId: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const catalog = await listWorkItems()
      const today = localTodayYmd()
      const items = catalog.items.map((it) => {
        const { startOn, endOn } = ensureScheduleDates(it, today)
        if (it.startOn === startOn && it.endOn === endOn) return it
        return { ...it, startOn, endOn }
      })
      set({
        lists: catalog.lists,
        items,
        loaded: true,
        loading: false,
        error: null,
      })
      // Opportunistic trash badge hydrate (non-blocking).
      void listWorkItemsTrash()
        .then((items) => {
          void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
            useTrashBadgeStore.getState().setWorkItemCount(items.length)
          })
        })
        .catch(() => undefined)
    } catch (e) {
      set({
        loaded: true,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load work items',
      })
    }
  },

  save: () =>
    enqueueSave(async () => {
      try {
        await saveWorkItems(toCatalog(get()))
        set({ error: null })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to save work items'
        set({ error: msg })
        throw e
      }
    }),

  flushSave: async () => {
    get().finalizeSelectedItem()
    // Commit any remaining notes draft (finalize may already have applied it).
    get().commitNotesDraft()
    // Drain chain (includes saves enqueued by finalize / commit).
    await saveChain
  },

  finalizeSelectedItem: () => {
    const id = get().selectedId
    if (!id) return
    const item = get().items.find((i) => i.id === id)
    if (!item) return

    const notes = pendingNotesFor(id, item.notes)
    const emptyTitle = item.title.trim() === ''
    const extras = hasExtras(item, notes)

    if (emptyTitle && !extras) {
      // Discard empty shell item.
      clearNotesDebounceTimer()
      if (notesDraft?.id === id) notesDraft = null
      set((s) => ({
        items: s.items.filter((i) => i.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        error: null,
      }))
      void get().save()
      return
    }

    if (emptyTitle && extras) {
      // Promote to Untitled and flush notes draft into item.
      clearNotesDebounceTimer()
      const draftNotes = notesDraft?.id === id ? notesDraft.notes : null
      if (notesDraft?.id === id) notesDraft = null
      const now = Date.now()
      set((s) => ({
        items: s.items.map((i) =>
          i.id === id
            ? {
                ...i,
                title: UNTITLED_WORK_ITEM,
                notes: draftNotes ?? i.notes,
                updatedAt: now,
              }
            : i,
        ),
        error: null,
      }))
      void get().save()
      return
    }

    // Title present: still commit pending notes draft if any.
    if (notesDraft?.id === id) {
      clearNotesDebounceTimer()
      const draftNotes = notesDraft.notes
      notesDraft = null
      if (draftNotes !== item.notes) {
        const now = Date.now()
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, notes: draftNotes, updatedAt: now } : i,
          ),
          error: null,
        }))
        void get().save()
      }
    }
  },

  createItem: async (partial, options) => {
    get().finalizeSelectedItem()
    const now = Date.now()
    const listId =
      partial?.listId && get().lists.some((l) => l.id === partial.listId)
        ? partial.listId
        : listIdFromFilter(get().filterId, get().lists)
    const filterId = get().filterId
    let status: WorkItemStatus | undefined = partial?.status
    if (status == null) {
      if (filterId === 'todo' || filterId === 'in_progress' || filterId === 'done') {
        status = filterId
      } else {
        status = 'todo'
      }
    }
    const item = defaultItem(now, listId, { ...partial, status })
    const select = options?.select === true
    set((s) => ({
      items: [...s.items, item],
      selectedId: select ? item.id : s.selectedId,
      error: null,
    }))
    await get().save()
    return item.id
  },

  updateItem: async (id, patch) => {
    const prev = get().items.find((i) => i.id === id)
    if (!prev) return
    const now = Date.now()
    const today = localTodayYmd()
    const nextPatch: Partial<WorkItem> = { ...patch }
    if (nextPatch.links) {
      nextPatch.links = sanitizeLinksPatch({ ...prev.links, ...nextPatch.links })
    }
    // Do not let callers stomp id/createdAt via patch.
    delete (nextPatch as { id?: string }).id
    delete (nextPatch as { createdAt?: number }).createdAt

    // Schedule: null clears are filled with ensure; never leave null after write.
    if ('startOn' in nextPatch || 'endOn' in nextPatch) {
      const ensured = ensureScheduleDates(
        {
          startOn: nextPatch.startOn !== undefined ? nextPatch.startOn : prev.startOn,
          endOn: nextPatch.endOn !== undefined ? nextPatch.endOn : prev.endOn,
        },
        today,
      )
      nextPatch.startOn = ensured.startOn
      nextPatch.endOn = ensured.endOn
    }

    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? {
              ...i,
              ...nextPatch,
              links: nextPatch.links ?? i.links,
              updatedAt: now,
            }
          : i,
      ),
      error: null,
    }))
    await get().save()
  },

  commitItemDraft: async (id, draft) => {
    const today = localTodayYmd()
    const schedule = ensureScheduleDates(
      { startOn: draft.startOn, endOn: draft.endOn },
      today,
    )
    const title = draft.title.trim()
    if (!title) {
      throw new Error('title required')
    }
    if (id == null) {
      return get().createItem(
        {
          title,
          startOn: schedule.startOn,
          endOn: schedule.endOn,
          status: draft.status,
          priority: draft.priority,
          notes: draft.notes,
          tags: draft.tags,
        },
        { select: false },
      )
    }
    const prev = get().items.find((i) => i.id === id)
    if (!prev) throw new Error('item not found')
    const now = Date.now()
    let completedAt = prev.completedAt
    if (draft.status === 'todo' || draft.status === 'in_progress') {
      completedAt = null
    } else if (completedAt == null) {
      completedAt = now
    }
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? {
              ...i,
              title,
              startOn: schedule.startOn,
              endOn: schedule.endOn,
              status: draft.status,
              priority: draft.priority,
              notes: draft.notes,
              tags: draft.tags,
              completedAt,
              updatedAt: now,
            }
          : i,
      ),
      error: null,
    }))
    await get().save()
    return id
  },

  select: (id) => {
    const prev = get().selectedId
    if (prev === id) return
    get().finalizeSelectedItem()
    set({ selectedId: id })
  },

  setStatus: async (id, status) => {
    const item = get().items.find((i) => i.id === id)
    if (!item) return
    const next = applyStatus(item, status, Date.now())
    if (next === item) return
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? next : i)),
      error: null,
    }))
    await get().save()
  },

  complete: async (id) => {
    await get().setStatus(id, 'done')
  },

  reopen: async (id) => {
    await get().setStatus(id, 'todo')
  },

  cancel: async (id) => {
    await get().setStatus(id, 'cancelled')
  },

  archive: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.archivedAt != null) return
    const now = Date.now()
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id ? { ...i, archivedAt: now, updatedAt: now } : i,
      ),
      error: null,
    }))
    await get().save()
  },

  unarchive: async (id) => {
    const item = get().items.find((i) => i.id === id)
    if (!item || item.archivedAt == null) return
    const now = Date.now()
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id ? { ...i, archivedAt: null, updatedAt: now } : i,
      ),
      error: null,
    }))
    await get().save()
  },

  deleteItem: async (id) => {
    const prev = get().items.find((i) => i.id === id)
    if (!prev) return
    clearNotesDebounceTimer()
    if (notesDraft?.id === id) notesDraft = null
    // Optimistic remove; Rust soft-delete rewrites catalog + trash atomically.
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      error: null,
    }))
    try {
      await softDeleteWorkItem(id)
      void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
        useTrashBadgeStore.getState().adjustWorkItems(1)
      })
    } catch (e) {
      // Roll back optimistic removal and re-hydrate from disk.
      set({ error: e instanceof Error ? e.message : String(e) })
      try {
        await get().load()
      } catch {
        // keep error
      }
      throw e
    }
  },

  restoreTrashEntry: async (entryId) => {
    const item = await restoreWorkItemTrashEntry(entryId)
    set((s) => {
      if (s.items.some((i) => i.id === item.id)) {
        return {
          items: s.items.map((i) => (i.id === item.id ? item : i)),
          error: null,
        }
      }
      return { items: [...s.items, item], error: null }
    })
    void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
      useTrashBadgeStore.getState().adjustWorkItems(-1)
    })
    return item.id
  },

  createList: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) {
      const msg = 'List name is required'
      set({ error: msg })
      throw new Error(msg)
    }
    const now = Date.now()
    const maxSort = get().lists.reduce((m, l) => Math.max(m, l.sortOrder), 0)
    const list: WorkItemList = {
      id: mintWorkListId(),
      name: trimmed,
      sortOrder: maxSort + 1,
      createdAt: now,
      updatedAt: now,
    }
    set((s) => ({
      lists: [...s.lists, list],
      error: null,
    }))
    await get().save()
    return list.id
  },

  renameList: async (id, name) => {
    if (id === INBOX_LIST_ID) return
    const trimmed = name.trim()
    if (!trimmed) {
      const msg = 'List name is required'
      set({ error: msg })
      throw new Error(msg)
    }
    const now = Date.now()
    set((s) => ({
      lists: s.lists.map((l) =>
        l.id === id ? { ...l, name: trimmed, updatedAt: now } : l,
      ),
      error: null,
    }))
    await get().save()
  },

  deleteList: async (id) => {
    if (id === INBOX_LIST_ID) return
    const list = get().lists.find((l) => l.id === id)
    if (!list || list.system === 'inbox') return
    const now = Date.now()
    set((s) => ({
      lists: s.lists.filter((l) => l.id !== id),
      items: s.items.map((i) =>
        i.listId === id ? { ...i, listId: INBOX_LIST_ID, updatedAt: now } : i,
      ),
      // If filtering this list, fall back to open.
      filterId: s.filterId === `list:${id}` ? 'todo' : s.filterId,
      error: null,
    }))
    await get().save()
  },

  setFilter: (filterId) => {
    set({ filterId })
  },

  setSearch: (search) => {
    set({ search })
  },

  setNotesDraft: (id, notes) => {
    notesDraft = { id, notes }
    clearNotesDebounceTimer()
    notesDebounceTimer = setTimeout(() => {
      notesDebounceTimer = null
      const draft = notesDraft
      notesDraft = null
      if (!draft) return
      void get().updateItem(draft.id, { notes: draft.notes })
    }, NOTES_DEBOUNCE_MS)
  },

  commitNotesDraft: () => {
    clearNotesDebounceTimer()
    const draft = notesDraft
    notesDraft = null
    if (!draft) return
    const item = get().items.find((i) => i.id === draft.id)
    if (!item || item.notes === draft.notes) return
    void get().updateItem(draft.id, { notes: draft.notes })
  },
}))

/** Test helper: reset module-level save chain and notes draft. */
export function __resetWorkItemStoreInternalsForTests(): void {
  clearNotesDebounceTimer()
  notesDraft = null
  saveChain = Promise.resolve()
}
