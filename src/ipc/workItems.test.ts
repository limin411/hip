import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emptyDefaultCatalog } from '@/domain/work-items/normalize'
import { INBOX_LIST_ID } from '@/domain/work-items/ids'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import { listWorkItems, saveWorkItems } from './workItems'

describe('workItems IPC', () => {
  beforeEach(() => invoke.mockReset())

  it('listWorkItems invokes work_items_list and normalizes', async () => {
    invoke.mockResolvedValueOnce({
      version: 1,
      lists: [
        {
          id: INBOX_LIST_ID,
          name: 'Inbox',
          sortOrder: 0,
          createdAt: 0,
          updatedAt: 0,
          system: 'inbox',
        },
      ],
      items: [
        {
          id: 'wi_1',
          title: 'Hello',
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
        },
      ],
    })
    const cat = await listWorkItems()
    expect(invoke).toHaveBeenCalledWith('work_items_list')
    expect(cat.version).toBe(1)
    expect(cat.lists[0]?.id).toBe(INBOX_LIST_ID)
    expect(cat.items).toHaveLength(1)
    expect(cat.items[0]?.endOn).toBe('2026-07-25')
    // Normalize fills missing start from end
    expect(cat.items[0]?.startOn).toBe('2026-07-25')
  })

  it('listWorkItems normalizes malformed rows via domain normalizeCatalog', async () => {
    invoke.mockResolvedValueOnce({
      version: 1,
      lists: [],
      items: [{ id: 'nope' }, { id: 'wi_ok', title: 'x', status: 'todo', priority: 'low', listId: 'wl_missing', createdAt: 1, updatedAt: 1 }],
    })
    const cat = await listWorkItems()
    expect(cat.lists.some((l) => l.id === INBOX_LIST_ID)).toBe(true)
    expect(cat.items).toHaveLength(1)
    expect(cat.items[0]?.id).toBe('wi_ok')
    expect(cat.items[0]?.listId).toBe(INBOX_LIST_ID)
  })

  it('listWorkItems propagates IPC errors', async () => {
    invoke.mockRejectedValueOnce(new Error('no work-items dir'))
    await expect(listWorkItems()).rejects.toThrow('no work-items dir')
  })

  it('saveWorkItems invokes work_items_save with flat { catalog } payload', async () => {
    invoke.mockResolvedValueOnce(undefined)
    const catalog = emptyDefaultCatalog(100)
    await saveWorkItems(catalog)
    expect(invoke).toHaveBeenCalledWith('work_items_save', { catalog })
  })
})
