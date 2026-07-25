import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { INBOX_LIST_ID, localTodayYmd } from '@/domain/work-items'
import type { WorkItem, WorkItemList } from '@/domain/work-items'

const listWorkItems = vi.fn()
const saveWorkItems = vi.fn()
const softDeleteWorkItem = vi.fn()
const restoreWorkItemTrashEntry = vi.fn()
const listWorkItemsTrash = vi.fn()

vi.mock('@/ipc/workItems', () => ({
  listWorkItems: (...a: unknown[]) => listWorkItems(...a),
  saveWorkItems: (...a: unknown[]) => saveWorkItems(...a),
  softDeleteWorkItem: (...a: unknown[]) => softDeleteWorkItem(...a),
  restoreWorkItemTrashEntry: (...a: unknown[]) => restoreWorkItemTrashEntry(...a),
  listWorkItemsTrash: (...a: unknown[]) => listWorkItemsTrash(...a),
}))

import {
  UNTITLED_WORK_ITEM,
  useWorkItemStore,
  __resetWorkItemStoreInternalsForTests,
} from './workItemStore'

function inbox(now = 1): WorkItemList {
  return {
    id: INBOX_LIST_ID,
    name: 'Inbox',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    system: 'inbox',
  }
}

function item(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: '',
    status: 'todo',
    priority: 'none',
    listId: INBOX_LIST_ID,
    tags: [],
    notes: '',
    startOn: '2026-07-25',
    endOn: '2026-07-25',
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    archivedAt: null,
    links: {},
    ...partial,
  }
}

describe('workItemStore', () => {
  beforeEach(() => {
    __resetWorkItemStoreInternalsForTests()
    listWorkItems.mockReset().mockResolvedValue({
      version: 1,
      lists: [inbox()],
      items: [],
    })
    saveWorkItems.mockReset().mockResolvedValue(undefined)
    softDeleteWorkItem.mockReset().mockResolvedValue({
      id: 'tentry_1',
      itemId: 'wi_x',
      title: 'ops',
      deletedAt: 1,
      status: 'todo',
    })
    restoreWorkItemTrashEntry.mockReset()
    listWorkItemsTrash.mockReset().mockResolvedValue([])
    useWorkItemStore.setState({
      loaded: false,
      loading: false,
      error: null,
      lists: [inbox()],
      items: [],
      filterId: 'all',
      search: '',
      selectedId: null,
    })
  })

  afterEach(() => {
    __resetWorkItemStoreInternalsForTests()
  })

  it('defaults filterId to all', () => {
    expect(useWorkItemStore.getState().filterId).toBe('all')
  })

  it('load hydrates lists and items', async () => {
    const wi = item({ id: 'wi_a', title: 'A' })
    listWorkItems.mockResolvedValueOnce({
      version: 1,
      lists: [inbox()],
      items: [wi],
    })
    await useWorkItemStore.getState().load()
    const s = useWorkItemStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.loading).toBe(false)
    const today = localTodayYmd()
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({
      id: 'wi_a',
      title: 'A',
      startOn: today,
      endOn: today,
    })
    expect(s.error).toBeNull()
  })

  it('load surfaces IPC errors without throwing', async () => {
    listWorkItems.mockRejectedValueOnce(new Error('no tauri'))
    await useWorkItemStore.getState().load()
    const s = useWorkItemStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.error).toBe('no tauri')
  })

  it('createItem mints id, defaults, selects, and saves', async () => {
    const id = await useWorkItemStore.getState().createItem({}, { select: true })
    expect(id.startsWith('wi_')).toBe(true)
    const s = useWorkItemStore.getState()
    expect(s.selectedId).toBe(id)
    expect(s.items).toHaveLength(1)
    const today = localTodayYmd()
    expect(s.items[0]).toMatchObject({
      id,
      title: '',
      status: 'todo',
      priority: 'none',
      listId: INBOX_LIST_ID,
      startOn: today,
      endOn: today,
      notes: '',
    })
    expect(saveWorkItems).toHaveBeenCalled()
  })

  it('finalizeSelectedItem discards empty title with only default schedule', async () => {
    const id = await useWorkItemStore.getState().createItem({}, { select: true })
    saveWorkItems.mockClear()
    useWorkItemStore.getState().finalizeSelectedItem()
    await useWorkItemStore.getState().flushSave()
    expect(useWorkItemStore.getState().items.find((i) => i.id === id)).toBeUndefined()
  })

  it('finalizeSelectedItem keeps Untitled when non-default schedule', async () => {
    const id = await useWorkItemStore.getState().createItem(
      { startOn: '2026-07-01', endOn: '2026-07-03' },
      { select: true },
    )
    saveWorkItems.mockClear()
    useWorkItemStore.getState().finalizeSelectedItem()
    await useWorkItemStore.getState().flushSave()
    const wi = useWorkItemStore.getState().items.find((i) => i.id === id)
    expect(wi?.title).toBe(UNTITLED_WORK_ITEM)
  })

  it('createItem uses list filter for listId', async () => {
    const list: WorkItemList = {
      id: 'wl_proj',
      name: 'Proj',
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    useWorkItemStore.setState({
      lists: [inbox(), list],
      filterId: 'list:wl_proj',
    })
    const id = await useWorkItemStore.getState().createItem()
    expect(useWorkItemStore.getState().items.find((i) => i.id === id)?.listId).toBe(
      'wl_proj',
    )
  })

  it('createItem defaults status from active status filter', async () => {
    useWorkItemStore.setState({ filterId: 'in_progress' })
    const id = await useWorkItemStore.getState().createItem()
    expect(useWorkItemStore.getState().items.find((i) => i.id === id)?.status).toBe(
      'in_progress',
    )
  })

  it('finalizeSelectedItem discards empty title with no extras', async () => {
    const id = await useWorkItemStore.getState().createItem({}, { select: true })
    saveWorkItems.mockClear()
    useWorkItemStore.getState().finalizeSelectedItem()
    await useWorkItemStore.getState().flushSave()
    expect(useWorkItemStore.getState().items.find((i) => i.id === id)).toBeUndefined()
    expect(useWorkItemStore.getState().selectedId).toBeNull()
    expect(saveWorkItems).toHaveBeenCalled()
  })

  it('finalizeSelectedItem sets Untitled when empty title has extras', async () => {
    const id = await useWorkItemStore.getState().createItem({}, { select: true })
    await useWorkItemStore.getState().updateItem(id, { notes: 'keep me' })
    saveWorkItems.mockClear()
    useWorkItemStore.getState().finalizeSelectedItem()
    await useWorkItemStore.getState().flushSave()
    const wi = useWorkItemStore.getState().items.find((i) => i.id === id)
    expect(wi?.title).toBe(UNTITLED_WORK_ITEM)
    expect(wi?.notes).toBe('keep me')
    expect(saveWorkItems).toHaveBeenCalled()
  })

  it('select finalizes previous item (discards empty shell)', async () => {
    const emptyId = await useWorkItemStore.getState().createItem({}, { select: true })
    const keptId = await useWorkItemStore.getState().createItem({ title: 'Keep' }, { select: true })
    // createItem selects the new one; re-select empty then switch away.
    useWorkItemStore.setState({
      items: [
        item({ id: emptyId, title: '' }),
        item({ id: keptId, title: 'Keep' }),
      ],
      selectedId: emptyId,
    })
    useWorkItemStore.getState().select(keptId)
    expect(useWorkItemStore.getState().items.find((i) => i.id === emptyId)).toBeUndefined()
    expect(useWorkItemStore.getState().selectedId).toBe(keptId)
  })

  it('deleteList migrates items to inbox', async () => {
    const list: WorkItemList = {
      id: 'wl_gone',
      name: 'Gone',
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    useWorkItemStore.setState({
      lists: [inbox(), list],
      items: [
        item({ id: 'wi_1', title: 'A', listId: 'wl_gone' }),
        item({ id: 'wi_2', title: 'B', listId: INBOX_LIST_ID }),
      ],
      filterId: 'list:wl_gone',
      loaded: true,
    })
    await useWorkItemStore.getState().deleteList('wl_gone')
    const s = useWorkItemStore.getState()
    expect(s.lists.find((l) => l.id === 'wl_gone')).toBeUndefined()
    expect(s.items.find((i) => i.id === 'wi_1')?.listId).toBe(INBOX_LIST_ID)
    expect(s.filterId).toBe('todo')
    expect(saveWorkItems).toHaveBeenCalled()
  })

  it('deleteList does not remove inbox', async () => {
    useWorkItemStore.setState({ lists: [inbox()], items: [], loaded: true })
    await useWorkItemStore.getState().deleteList(INBOX_LIST_ID)
    expect(useWorkItemStore.getState().lists).toHaveLength(1)
    expect(saveWorkItems).not.toHaveBeenCalled()
  })

  it('saveChain is invoked on mutations (saveWorkItems)', async () => {
    await useWorkItemStore.getState().createItem({ title: 'x' })
    expect(saveWorkItems).toHaveBeenCalledTimes(1)
    const id = useWorkItemStore.getState().items[0]!.id
    await useWorkItemStore.getState().updateItem(id, { priority: 'high' })
    expect(saveWorkItems).toHaveBeenCalledTimes(2)
    await useWorkItemStore.getState().complete(id)
    expect(saveWorkItems).toHaveBeenCalledTimes(3)
    const last = saveWorkItems.mock.calls.at(-1)?.[0]
    expect(last?.items[0]?.status).toBe('done')
    expect(last?.items[0]?.completedAt).toEqual(expect.any(Number))
  })

  it('setNotesDraft debounces then saves; commitNotesDraft flushes early', async () => {
    vi.useFakeTimers()
    try {
      const id = await useWorkItemStore.getState().createItem({ title: 'n' })
      saveWorkItems.mockClear()
      useWorkItemStore.getState().setNotesDraft(id, 'draft-a')
      expect(saveWorkItems).not.toHaveBeenCalled()
      useWorkItemStore.getState().setNotesDraft(id, 'draft-b')
      await vi.advanceTimersByTimeAsync(300)
      // debounce callback schedules updateItem which is async
      await vi.runAllTimersAsync()
      await Promise.resolve()
      await useWorkItemStore.getState().flushSave()
      expect(useWorkItemStore.getState().items.find((i) => i.id === id)?.notes).toBe(
        'draft-b',
      )
      expect(saveWorkItems).toHaveBeenCalled()

      saveWorkItems.mockClear()
      useWorkItemStore.getState().setNotesDraft(id, 'blur-now')
      useWorkItemStore.getState().commitNotesDraft()
      await useWorkItemStore.getState().flushSave()
      expect(useWorkItemStore.getState().items.find((i) => i.id === id)?.notes).toBe(
        'blur-now',
      )
      expect(saveWorkItems).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushSave finalizes empty selected item before drain', async () => {
    await useWorkItemStore.getState().createItem({}, { select: true })
    saveWorkItems.mockClear()
    await useWorkItemStore.getState().flushSave()
    expect(useWorkItemStore.getState().items).toHaveLength(0)
    expect(useWorkItemStore.getState().selectedId).toBeNull()
  })

  it('status helpers: reopen / cancel / archive / unarchive / deleteItem', async () => {
    const id = await useWorkItemStore.getState().createItem({ title: 'ops' })
    await useWorkItemStore.getState().complete(id)
    expect(useWorkItemStore.getState().items[0]?.status).toBe('done')

    await useWorkItemStore.getState().reopen(id)
    expect(useWorkItemStore.getState().items[0]?.status).toBe('todo')
    expect(useWorkItemStore.getState().items[0]?.completedAt).toBeNull()

    await useWorkItemStore.getState().cancel(id)
    expect(useWorkItemStore.getState().items[0]?.status).toBe('cancelled')

    await useWorkItemStore.getState().archive(id)
    expect(useWorkItemStore.getState().items[0]?.archivedAt).toEqual(expect.any(Number))

    await useWorkItemStore.getState().unarchive(id)
    expect(useWorkItemStore.getState().items[0]?.archivedAt).toBeNull()

    saveWorkItems.mockClear()
    softDeleteWorkItem.mockClear()
    await useWorkItemStore.getState().deleteItem(id)
    expect(useWorkItemStore.getState().items).toHaveLength(0)
    expect(softDeleteWorkItem).toHaveBeenCalledWith(id)
    // Soft-delete rewrites catalog in Rust; store must not full-save after.
    expect(saveWorkItems).not.toHaveBeenCalled()
  })

  it('restoreTrashEntry inserts item back into store', async () => {
    const restored = item({ id: 'wi_restored', title: 'Back' })
    restoreWorkItemTrashEntry.mockResolvedValueOnce(restored)
    const id = await useWorkItemStore.getState().restoreTrashEntry('tentry_1')
    expect(id).toBe('wi_restored')
    expect(useWorkItemStore.getState().items.some((i) => i.id === 'wi_restored')).toBe(true)
    expect(restoreWorkItemTrashEntry).toHaveBeenCalledWith('tentry_1')
  })
})
