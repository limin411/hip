// src/ipc/automations.ts
import { invoke } from '@tauri-apps/api/core'
import type { AutomationsCatalogV1, AutomationRunsLogV1 } from '@/domain/automations/types'
import { normalizeCatalog, normalizeRunsLog } from '@/domain/automations/normalize'

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
