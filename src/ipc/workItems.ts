// src/ipc/workItems.ts
import { invoke } from '@tauri-apps/api/core'
import type { WorkItemsCatalogV1 } from '@/domain/work-items/types'
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
