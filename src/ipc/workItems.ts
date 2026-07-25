// src/ipc/workItems.ts
import { invoke } from '@tauri-apps/api/core'
import type { WorkItem, WorkItemsCatalogV1 } from '@/domain/work-items/types'
import { normalizeCatalog } from '@/domain/work-items/normalize'

/**
 * Load the work-items catalog from `~/.hip/work-items/catalog.json`.
 * Missing/corrupt file is handled in Rust as a default Inbox catalog (does not reject).
 * IPC failures **propagate** so the store can surface `error`.
 */
export async function listWorkItems(): Promise<WorkItemsCatalogV1> {
  const raw = await invoke<unknown>('work_items_list')
  return normalizeCatalog(raw)
}

/** Persist the full catalog (atomic 0o600 write + validation on the Rust side). */
export async function saveWorkItems(catalog: WorkItemsCatalogV1): Promise<void> {
  await invoke<void>('work_items_save', { catalog })
}

/** Soft-deleted work item as shown in the product recycle bin. */
export type WorkItemTrashItem = {
  id: string
  itemId: string
  title: string
  deletedAt: number
  status: string
}

/** Soft-delete item into `~/.hip/trash/work-items/` and remove from live catalog. */
export async function softDeleteWorkItem(id: string): Promise<WorkItemTrashItem> {
  return invoke<WorkItemTrashItem>('work_items_soft_delete', { id })
}

export async function listWorkItemsTrash(): Promise<WorkItemTrashItem[]> {
  return invoke<WorkItemTrashItem[]>('work_items_list_trash')
}

/** Restore a trash entry into the live catalog; returns the restored item. */
export async function restoreWorkItemTrashEntry(entryId: string): Promise<WorkItem> {
  // Tauri maps camelCase JS keys to snake_case Rust params.
  const raw = await invoke<unknown>('work_items_restore_trash_entry', { entryId })
  // Normalize single item via a tiny catalog shell so ids/fields are safe.
  const cat = normalizeCatalog({
    version: 1,
    lists: [],
    items: [raw],
  })
  const item = cat.items[0]
  if (!item) throw new Error('restore returned empty item')
  return item
}

export async function hardDeleteWorkItemTrashEntry(entryId: string): Promise<void> {
  await invoke<void>('work_items_hard_delete_trash_entry', { entryId })
}

export async function emptyWorkItemsTrash(): Promise<number> {
  return invoke<number>('work_items_empty_trash')
}

export async function purgeExpiredWorkItemsTrash(
  retentionDays?: number,
): Promise<string[]> {
  return invoke<string[]>('work_items_purge_expired_trash', {
    retentionDays: retentionDays ?? null,
  })
}
