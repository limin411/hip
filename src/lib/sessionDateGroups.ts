/**
 * Group chat sessions by last-activity date buckets for the sidebar.
 * Order: Today → Yesterday → Previous 7 days → Previous 30 days → Older.
 * Within each group: newest first (updatedAtMs desc).
 */

export type SessionDateBucketId =
  | 'today'
  | 'yesterday'
  | 'previous7'
  | 'previous30'
  | 'older'

export interface SessionDateGroup<T> {
  bucketId: SessionDateBucketId
  sessions: T[]
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Bucket for a timestamp relative to `nowMs` (local calendar). */
export function dateBucketFor(
  updatedAtMs: number,
  nowMs: number = Date.now(),
): SessionDateBucketId {
  const todayStart = startOfLocalDay(nowMs)
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000
  const day7Start = todayStart - 7 * 24 * 60 * 60 * 1000
  const day30Start = todayStart - 30 * 24 * 60 * 60 * 1000
  if (updatedAtMs >= todayStart) return 'today'
  if (updatedAtMs >= yesterdayStart) return 'yesterday'
  if (updatedAtMs >= day7Start) return 'previous7'
  if (updatedAtMs >= day30Start) return 'previous30'
  return 'older'
}

const BUCKET_ORDER: SessionDateBucketId[] = [
  'today',
  'yesterday',
  'previous7',
  'previous30',
  'older',
]

/**
 * Group sessions by date bucket. Empty buckets are omitted.
 * Sessions within a group are newest-first.
 */
export function groupSessionsByDate<T extends { updatedAtMs: number }>(
  sessions: T[],
  nowMs: number = Date.now(),
): SessionDateGroup<T>[] {
  const map = new Map<SessionDateBucketId, T[]>()
  for (const s of sessions) {
    const bucket = dateBucketFor(s.updatedAtMs, nowMs)
    const list = map.get(bucket)
    if (list) list.push(s)
    else map.set(bucket, [s])
  }
  const groups: SessionDateGroup<T>[] = []
  for (const bucketId of BUCKET_ORDER) {
    const list = map.get(bucketId)
    if (!list || list.length === 0) continue
    groups.push({
      bucketId,
      sessions: [...list].sort((a, b) => b.updatedAtMs - a.updatedAtMs),
    })
  }
  return groups
}
