import type { DatabaseSync } from '../persistence/sqlite.js'

/** Read/write helpers for memory_runtime KV (schema v19). */

export function runtimeGet(db: DatabaseSync, key: string): unknown | undefined {
  try {
    const row = db.prepare(`SELECT value_json FROM memory_runtime WHERE key=?`).get(key) as
      | { value_json: string }
      | undefined
    if (!row) return undefined
    return JSON.parse(row.value_json) as unknown
  } catch {
    return undefined
  }
}

export function runtimeSet(db: DatabaseSync, key: string, value: unknown, now = Date.now()): void {
  try {
    db.prepare(
      `INSERT INTO memory_runtime(key, value_json, updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    ).run(key, JSON.stringify(value), now)
  } catch (err) {
    console.warn(
      '[memory-runtime] set failed',
      key,
      err instanceof Error ? err.message : String(err),
    )
  }
}

export function runtimeGetNumber(db: DatabaseSync, key: string): number | undefined {
  const v = runtimeGet(db, key)
  if (v && typeof v === 'object' && typeof (v as { n?: unknown }).n === 'number') {
    return (v as { n: number }).n
  }
  if (typeof v === 'number') return v
  return undefined
}

export function runtimeSetNumber(db: DatabaseSync, key: string, n: number, now = Date.now()): void {
  runtimeSet(db, key, { n }, now)
}
