// src/ipc/automations.ts
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  Automation,
  AutomationsCatalogV1,
  AutomationRunsLogV1,
} from '@/domain/automations/types'
import { normalizeAutomation, normalizeCatalog, normalizeRunsLog } from '@/domain/automations/normalize'

/**
 * Subscribe to the native schedule tick (`automation://tick`, every 30s).
 *
 * The tick is emitted by the Rust runtime on purpose: WebView2 throttles the
 * webview's own `setInterval` while the main window is hidden to tray or
 * minimized, which used to silently disable every scheduled automation.
 * Rejects when there is no IPC host (plain browser, no Tauri shell).
 */
export function listenAutomationTick(handler: () => void): Promise<UnlistenFn> {
  return listen<null>('automation://tick', () => handler())
}

/**
 * Load the automations catalog from `~/.hip/automations/catalog.json`.
 * Missing/corrupt file is handled in Rust as an empty catalog (does not reject).
 * IPC failures **propagate** so the store can surface `error`.
 */
export async function listAutomations(): Promise<AutomationsCatalogV1> {
  const raw = await invoke<unknown>('automations_list')
  return normalizeCatalog(raw)
}

/** Persist the full catalog (atomic 0o600 write + validation on the Rust side). */
export async function saveAutomations(catalog: AutomationsCatalogV1): Promise<void> {
  await invoke<void>('automations_save', { catalog })
}

/**
 * Load the automation runs log from `~/.hip/automations/runs.json`.
 * Missing/corrupt file is handled in Rust as an empty log (does not reject).
 * IPC failures **propagate** so the store can surface `error`.
 */
export async function listAutomationRuns(): Promise<AutomationRunsLogV1> {
  const raw = await invoke<unknown>('automation_runs_list')
  return normalizeRunsLog(raw)
}

/** Persist the full runs log (atomic 0o600 write + validation on the Rust side). */
export async function saveAutomationRuns(log: AutomationRunsLogV1): Promise<void> {
  await invoke<void>('automation_runs_save', { log })
}

/** Soft-deleted automation as shown in the product recycle bin. */
export type AutomationTrashItem = {
  id: string
  automationId: string
  name: string
  deletedAt: number
  enabled: boolean
  triggerKind: string
}

/** Soft-delete into `~/.hip/trash/automations/` and remove from live catalog. */
export async function softDeleteAutomation(id: string): Promise<AutomationTrashItem> {
  return invoke<AutomationTrashItem>('automations_soft_delete', { id })
}

export async function listAutomationsTrash(): Promise<AutomationTrashItem[]> {
  return invoke<AutomationTrashItem[]>('automations_list_trash')
}

/** Restore a trash entry into the live catalog; returns the restored automation. */
export async function restoreAutomationTrashEntry(entryId: string): Promise<Automation> {
  const raw = await invoke<unknown>('automations_restore_trash_entry', { entryId })
  const a = normalizeAutomation(raw)
  if (!a) throw new Error('restore returned empty automation')
  return a
}

export async function hardDeleteAutomationTrashEntry(entryId: string): Promise<void> {
  await invoke<void>('automations_hard_delete_trash_entry', { entryId })
}

export async function emptyAutomationsTrash(): Promise<number> {
  return invoke<number>('automations_empty_trash')
}

export async function purgeExpiredAutomationsTrash(
  retentionDays?: number,
): Promise<string[]> {
  return invoke<string[]>('automations_purge_expired_trash', {
    retentionDays: retentionDays ?? null,
  })
}
