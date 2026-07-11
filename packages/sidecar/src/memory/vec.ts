import type { DatabaseSync } from '../persistence/sqlite.js'

/** Pack float32 LE embedding into a BLOB. */
export function encodeEmbedding(vec: number[]): Buffer {
  const f = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) f[i] = vec[i]!
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength)
}

/** Decode BLOB (Buffer / Uint8Array / ArrayBuffer) back to number[]. */
export function decodeEmbedding(blob: Buffer | Uint8Array | ArrayBuffer): number[] {
  let buf: Buffer
  if (Buffer.isBuffer(blob)) {
    buf = blob
  } else if (blob instanceof ArrayBuffer) {
    buf = Buffer.from(blob)
  } else {
    buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
  }
  if (buf.byteLength % 4 !== 0) {
    throw new Error(`decodeEmbedding: blob length ${buf.byteLength} not multiple of 4`)
  }
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f)
}

export type EmbeddingRow = {
  memoryId: string
  modelKey: string
  dim: number
  embedding: number[]
  updatedAt: number
}

export function upsertEmbeddingMeta(
  db: DatabaseSync,
  modelKey: string,
  dim: number,
  updatedAt: number = Date.now(),
): void {
  db.prepare(`
    INSERT INTO memory_embedding_meta(model_key, dim, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(model_key) DO UPDATE SET
      dim=excluded.dim,
      updated_at=excluded.updated_at
  `).run(modelKey, dim, updatedAt)
}

export function getEmbeddingMeta(
  db: DatabaseSync,
  modelKey: string,
): { modelKey: string; dim: number; updatedAt: number } | undefined {
  const row = db.prepare(
    `SELECT model_key, dim, updated_at FROM memory_embedding_meta WHERE model_key=?`,
  ).get(modelKey) as { model_key: string; dim: number; updated_at: number } | undefined
  if (!row) return undefined
  return { modelKey: row.model_key, dim: row.dim, updatedAt: row.updated_at }
}

/**
 * Upsert primary BLOB row. When `vecEnabled`, also mirrors into optional
 * `memory_vec_{dim}` (vec0) if the extension is available.
 */
export function upsertEmbedding(
  db: DatabaseSync,
  row: {
    memoryId: string
    modelKey: string
    embedding: number[]
    updatedAt?: number
    vecEnabled?: boolean
  },
): void {
  const dim = row.embedding.length
  if (dim === 0) throw new Error('upsertEmbedding: empty embedding')
  const updatedAt = row.updatedAt ?? Date.now()
  const blob = encodeEmbedding(row.embedding)
  db.prepare(`
    INSERT INTO memory_embedding_rows(memory_id, model_key, dim, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      model_key=excluded.model_key,
      dim=excluded.dim,
      embedding=excluded.embedding,
      updated_at=excluded.updated_at
  `).run(row.memoryId, row.modelKey, dim, blob, updatedAt)
  upsertEmbeddingMeta(db, row.modelKey, dim, updatedAt)

  if (row.vecEnabled) {
    tryMirrorToVec0(db, row.memoryId, dim, row.embedding)
  }
}

export function getEmbedding(db: DatabaseSync, memoryId: string): EmbeddingRow | undefined {
  const row = db.prepare(
    `SELECT memory_id, model_key, dim, embedding, updated_at FROM memory_embedding_rows WHERE memory_id=?`,
  ).get(memoryId) as
    | {
        memory_id: string
        model_key: string
        dim: number
        embedding: Buffer | Uint8Array
        updated_at: number
      }
    | undefined
  if (!row) return undefined
  return {
    memoryId: row.memory_id,
    modelKey: row.model_key,
    dim: row.dim,
    embedding: decodeEmbedding(row.embedding),
    updatedAt: row.updated_at,
  }
}

export function deleteEmbedding(db: DatabaseSync, memoryId: string): void {
  db.prepare(`DELETE FROM memory_embedding_rows WHERE memory_id=?`).run(memoryId)
  // Best-effort: drop from any known vec0 mirrors (dim from deleted row is gone;
  // scan sqlite_master for memory_vec_* and delete by memory_id).
  deleteFromAllVec0(db, [memoryId])
}

/** Delete embedding rows for many memory ids (hard-delete paths). */
export function deleteEmbeddings(db: DatabaseSync, memoryIds: string[]): void {
  if (memoryIds.length === 0) return
  const stmt = db.prepare(`DELETE FROM memory_embedding_rows WHERE memory_id=?`)
  for (const id of memoryIds) stmt.run(id)
  deleteFromAllVec0(db, memoryIds)
}

/** Count active items vs embeddings for the given model_key (stale models excluded from embedded). */
export function embeddingIndexStatus(
  db: DatabaseSync,
  modelKey: string | undefined,
): { embedded: number; total: number; modelKey?: string } {
  const totalRow = db.prepare(
    `SELECT COUNT(*) AS c FROM memory_items WHERE status='active'`,
  ).get() as { c: number }
  const total = totalRow?.c ?? 0
  if (!modelKey) {
    return { embedded: 0, total }
  }
  const embRow = db.prepare(`
    SELECT COUNT(*) AS c FROM memory_embedding_rows e
    INNER JOIN memory_items m ON m.id = e.memory_id
    WHERE m.status='active' AND e.model_key=?
  `).get(modelKey) as { c: number }
  return { embedded: embRow?.c ?? 0, total, modelKey }
}

/** Optional vec0 virtual table name for a fixed dim. */
export function memoryVecTableName(dim: number): string {
  return `memory_vec_${dim}`
}

/**
 * Ensure `memory_vec_{dim}` exists when sqlite-vec is loaded.
 * Returns false if CREATE fails (extension missing or dim invalid).
 */
export function ensureVec0Table(db: DatabaseSync, dim: number): boolean {
  if (!Number.isInteger(dim) || dim <= 0) return false
  const name = memoryVecTableName(dim)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[${dim}]
      )
    `)
    return true
  } catch {
    return false
  }
}

function tryMirrorToVec0(
  db: DatabaseSync,
  memoryId: string,
  dim: number,
  embedding: number[],
): void {
  if (!ensureVec0Table(db, dim)) return
  const name = memoryVecTableName(dim)
  try {
    // vec0 rejects INSERT OR REPLACE on PK conflict — delete then insert.
    db.prepare(`DELETE FROM ${name} WHERE memory_id=?`).run(memoryId)
    db.prepare(`INSERT INTO ${name}(memory_id, embedding) VALUES (?, ?)`).run(
      memoryId,
      JSON.stringify(embedding),
    )
  } catch (e) {
    console.warn(
      '[memory] vec0 mirror failed',
      e instanceof Error ? e.message : String(e),
    )
  }
}

function deleteFromAllVec0(db: DatabaseSync, memoryIds: string[]): void {
  if (memoryIds.length === 0) return
  let tables: { name: string }[]
  try {
    tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name LIKE 'memory_vec_%'
    `).all() as { name: string }[]
  } catch {
    return
  }
  for (const t of tables) {
    if (!/^memory_vec_\d+$/.test(t.name)) continue
    try {
      const stmt = db.prepare(`DELETE FROM ${t.name} WHERE memory_id=?`)
      for (const id of memoryIds) stmt.run(id)
    } catch {
      // ignore missing / non-vec tables
    }
  }
}
