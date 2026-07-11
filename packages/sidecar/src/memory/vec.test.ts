import { describe, it, expect } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import {
  decodeEmbedding,
  encodeEmbedding,
  upsertEmbedding,
  getEmbedding,
  deleteEmbedding,
  embeddingIndexStatus,
  ensureVec0Table,
  memoryVecTableName,
} from './vec.js'

describe('vec encode/decode + BLOB store', () => {
  it('round-trips float32 vectors', () => {
    const v = [0.5, -1, 0, 2.25]
    const blob = encodeEmbedding(v)
    expect(blob.byteLength).toBe(16)
    expect(decodeEmbedding(blob)).toEqual(v)
  })

  it('upserts and reads embedding rows (BLOB path always works)', () => {
    const { db, memoriesVecEnabled } = openDatabase(':memory:')
    upsertEmbedding(db, {
      memoryId: 'm1',
      modelKey: 'openai/text-embedding-3-small',
      embedding: [1, 0, 0],
      vecEnabled: memoriesVecEnabled,
    })
    const row = getEmbedding(db, 'm1')
    expect(row?.modelKey).toBe('openai/text-embedding-3-small')
    expect(row?.dim).toBe(3)
    expect(row?.embedding).toEqual([1, 0, 0])

    const meta = db.prepare(
      `SELECT dim FROM memory_embedding_meta WHERE model_key=?`,
    ).get('openai/text-embedding-3-small') as { dim: number }
    expect(meta.dim).toBe(3)

    if (memoriesVecEnabled) {
      const name = memoryVecTableName(3)
      expect(ensureVec0Table(db, 3)).toBe(true)
      const knn = db.prepare(
        `SELECT memory_id, distance FROM ${name} WHERE embedding MATCH ? ORDER BY distance LIMIT 1`,
      ).all(JSON.stringify([1, 0, 0])) as { memory_id: string; distance: number }[]
      expect(knn[0]?.memory_id).toBe('m1')
      expect(knn[0]?.distance).toBeCloseTo(0, 5)
    }

    deleteEmbedding(db, 'm1')
    expect(getEmbedding(db, 'm1')).toBeUndefined()
    db.close()
  })

  it('embeddingIndexStatus counts active items for model_key', () => {
    const { db } = openDatabase(':memory:')
    const now = Date.now()
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, kind, title, content, confidence, status, source, tags_json,
        created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('a', 'global', 'lesson', 't', 'c', 0.5, 'active', 'user', '[]', now, now, 0, 0)
    db.prepare(`
      INSERT INTO memory_items(
        id, scope, kind, title, content, confidence, status, source, tags_json,
        created_at, updated_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run('b', 'global', 'lesson', 't2', 'c2', 0.5, 'active', 'user', '[]', now, now, 0, 0)

    upsertEmbedding(db, {
      memoryId: 'a',
      modelKey: 'm/k',
      embedding: [1, 0],
    })
    // stale model for b
    upsertEmbedding(db, {
      memoryId: 'b',
      modelKey: 'other/model',
      embedding: [0, 1],
    })

    expect(embeddingIndexStatus(db, 'm/k')).toEqual({
      embedded: 1,
      total: 2,
      modelKey: 'm/k',
    })
    db.close()
  })
})
