import type { MemoryFileConfig } from '@hip/protocol'
import type { MemoryStore } from './store.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Hard-delete soft-deleted memories older than trashRetentionDays (default 30).
 * Returns the number of rows purged.
 */
export function runTrashRetentionJob(
  store: MemoryStore,
  config: MemoryFileConfig,
  now: number = Date.now(),
): number {
  const days = config.trashRetentionDays ?? 30
  const cutoff = now - days * DAY_MS
  return store.purgeDeletedOlderThan(cutoff)
}
