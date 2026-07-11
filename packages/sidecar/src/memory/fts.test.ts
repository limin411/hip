import { describe, it, expect } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import { tryEnableMemoriesFts } from '../persistence/schema.js'
import { MemoryStore } from './store.js'
import type { MemoryItem } from '@hip/protocol'

function baseItem(over: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content'>): MemoryItem {
  return {
    scope: 'project',
    kind: 'lesson',
    confidence: 0.7,
    status: 'active',
    source: 'extract',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    useCount: 0,
    pinned: false,
    ...over,
  }
}

describe('memories FTS', () => {
  it('openDatabase reports memoriesFtsEnabled and creates virtual table', () => {
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    expect(memoriesFtsEnabled).toBe(true)
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' OR type='trigger'`).all() as { name: string }[]
    ).map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['memories_fts', 'memories_ai', 'memories_ad', 'memories_au']))
    db.close()
  })

  it('tryEnableMemoriesFts is idempotent', () => {
    const { db } = openDatabase(':memory:')
    expect(tryEnableMemoriesFts(db)).toBe(true)
    expect(tryEnableMemoriesFts(db)).toBe(true)
    db.close()
  })

  it('search with FTS excludes archived/deleted even if indexed', () => {
    const { db, memoriesFtsEnabled } = openDatabase(':memory:')
    const store = new MemoryStore(db, memoriesFtsEnabled)
    store.upsertItem(baseItem({ id: '1', title: 'ok', content: 'findme-active-token' }))
    store.upsertItem(baseItem({
      id: '2',
      title: 'no',
      content: 'findme-archived-token',
      status: 'archived',
    }))
    const hits = store.search('findme')
    expect(hits.every((h) => h.status === 'active')).toBe(true)
    expect(hits.map((h) => h.id)).toEqual(['1'])
    db.close()
  })

  it('LIKE fallback still works when fts disabled in MemoryStore', () => {
    const { db } = openDatabase(':memory:')
    // Force LIKE path even though FTS objects may exist.
    const store = new MemoryStore(db, false)
    store.upsertItem(baseItem({ id: '1', title: 't', content: 'substring-match-xyz' }))
    expect(store.search('substring-match-xyz').map((h) => h.id)).toEqual(['1'])
    db.close()
  })
})
