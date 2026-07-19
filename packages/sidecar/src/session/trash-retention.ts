/**
 * Product recycle-bin retention for Chat/Code sessions.
 * Knowledge purge is Tauri-side; this module only covers SQLite sessions.
 */
import type { SessionStore } from '../persistence/store.js'
import { readHipConfig } from '../config/hip-config.js'
import { logInfo } from '../debug-logger.js'

export const DEFAULT_TRASH_RETENTION_DAYS = 7
export const TRASH_RETENTION_MIN_DAYS = 1
export const TRASH_RETENTION_MAX_DAYS = 365
/** Housekeeping interval while sidecar is running. */
export const TRASH_RETENTION_INTERVAL_MS = 60 * 60 * 1000

/**
 * Clamp retention to [1, 365]. Non-finite / missing → default 7.
 * When `raw` omitted, reads hip.toml `[trash] retentionDays` if present.
 */
export function resolveTrashRetentionDays(raw?: number | null): number {
  let value = raw
  if (value == null || !Number.isFinite(value)) {
    try {
      value = readHipConfig().trash?.retentionDays
    } catch {
      value = undefined
    }
  }
  if (value == null || !Number.isFinite(value)) return DEFAULT_TRASH_RETENTION_DAYS
  const n = Math.floor(Number(value))
  if (n < TRASH_RETENTION_MIN_DAYS) return TRASH_RETENTION_MIN_DAYS
  if (n > TRASH_RETENTION_MAX_DAYS) return TRASH_RETENTION_MAX_DAYS
  return n
}

/**
 * Hard-purge soft-deleted sessions older than retentionDays.
 * @returns purged session ids
 */
export function runSessionTrashRetention(
  store: SessionStore,
  retentionDays: number = DEFAULT_TRASH_RETENTION_DAYS,
  nowMs: number = Date.now(),
): string[] {
  const days = resolveTrashRetentionDays(retentionDays)
  const purged = store.purgeTrashedByRetentionDays(days, nowMs)
  if (purged.length) {
    logInfo('session-trash', 'retention.purge', { retentionDays: days, count: purged.length, ids: purged })
  }
  return purged
}
