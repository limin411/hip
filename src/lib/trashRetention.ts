/** Product recycle-bin retention helpers (frontend). Mirrors sidecar clamp. */

export const DEFAULT_TRASH_RETENTION_DAYS = 7
export const TRASH_RETENTION_MIN_DAYS = 1
export const TRASH_RETENTION_MAX_DAYS = 365

export function resolveTrashRetentionDays(raw?: number | null): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_TRASH_RETENTION_DAYS
  const n = Math.floor(Number(raw))
  if (n < TRASH_RETENTION_MIN_DAYS) return TRASH_RETENTION_MIN_DAYS
  if (n > TRASH_RETENTION_MAX_DAYS) return TRASH_RETENTION_MAX_DAYS
  return n
}

/** Whole days remaining until permanent purge (min 0). */
export function daysLeftInTrash(deletedAt: number, retentionDays: number, now = Date.now()): number {
  const days = resolveTrashRetentionDays(retentionDays)
  const expiresAt = deletedAt + days * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)))
}
