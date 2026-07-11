import { describe, it, expect, beforeEach } from 'vitest'
import type { MemoryItem } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'

function item(partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content'>): MemoryItem {
  return {
    scope: 'project',
    kind: 'preference',
    confidence: 0.8,
    status: 'active',
    source: 'user',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    useCount: 0,
    pinned: false,
    projectKeyHash: 'pkh1',
    ...partial,
  }
}

function fresh() {
  const { db, memoriesFtsEnabled } = openDatabase(':memory:')
  return { db, store: new MemoryStore(db, memoriesFtsEnabled), fts: memoriesFtsEnabled }
}

describe('MemoryStore', () => {
  let store: MemoryStore
  let fts: boolean

  beforeEach(() => {
    ;({ store, fts } = fresh())
  })

  it('upsert + get + list round-trip', () => {
    store.upsertItem(item({
      id: 'm1',
      title: 'Prefer TypeScript',
      content: 'Use strict mode',
      tags: ['lang'],
      projectKey: 'proj',
      projectKeyHash: 'hash-a',
    }))
    const got = store.getItem('m1')
    expect(got).toMatchObject({
      id: 'm1',
      title: 'Prefer TypeScript',
      content: 'Use strict mode',
      tags: ['lang'],
      projectKey: 'proj',
      projectKeyHash: 'hash-a',
      pinned: false,
      status: 'active',
    })
    expect(store.listItems({ projectKeyHash: 'hash-a' })).toHaveLength(1)
    expect(store.listItems({ projectKeyHash: 'other' })).toHaveLength(0)
  })

  it('search finds content; excludes non-active status', () => {
    store.upsertItem(item({ id: 'a', title: 'Active tip', content: '配置密钥请在设置中配置' }))
    store.upsertItem(item({
      id: 'b',
      title: 'Archived tip',
      content: '配置密钥也在归档里',
      status: 'archived',
    }))
    store.upsertItem(item({
      id: 'c',
      title: 'Deleted tip',
      content: '配置密钥已删除',
      status: 'deleted',
    }))

    const hits = store.search('配置密钥')
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })

  it('FTS Chinese substring match when trigram available', () => {
    store.upsertItem(item({
      id: 'zh',
      title: '密钥提示',
      content: '未配置密钥请在设置中配置',
    }))
    const hits = store.search('设置中')
    if (fts) {
      expect(hits.map((h) => h.id)).toContain('zh')
    } else {
      // LIKE still matches substring
      expect(hits.map((h) => h.id)).toContain('zh')
    }
  })

  it('softDelete hides from search but keeps row', () => {
    store.upsertItem(item({ id: 's1', title: 'soft me', content: 'unique-soft-token-xyz' }))
    expect(store.search('unique-soft-token-xyz')).toHaveLength(1)
    expect(store.softDelete('s1')).toBe(true)
    expect(store.search('unique-soft-token-xyz')).toHaveLength(0)
    expect(store.getItem('s1')?.status).toBe('deleted')
  })

  it('hardDelete removes the row', () => {
    store.upsertItem(item({ id: 'h1', title: 'gone', content: 'hard-delete-token' }))
    expect(store.hardDelete('h1')).toBe(true)
    expect(store.getItem('h1')).toBeUndefined()
  })

  it('deleteBySourceSession hard deletes project items and stage1', () => {
    store.upsertItem(item({
      id: 'p1',
      title: 'derived',
      content: 'from session',
      scope: 'project',
      sourceSessionId: 'sess-1',
    }))
    store.upsertItem(item({
      id: 'p2',
      title: 'other',
      content: 'from other',
      scope: 'project',
      sourceSessionId: 'sess-2',
    }))
    store.upsertStage1({
      id: 'st1',
      sessionId: 'sess-1',
      rawMemory: 'raw',
      rolloutSummary: 'sum',
      status: 'pending',
      sourceUpdatedAt: 1,
      createdAt: 1,
    })

    const n = store.deleteBySourceSession('sess-1')
    expect(n).toBe(1)
    expect(store.getItem('p1')).toBeUndefined()
    expect(store.getItem('p2')).toBeDefined()
    const stageLeft = store.getDb()
      .prepare(`SELECT COUNT(*) AS n FROM memory_stage1 WHERE session_id=?`)
      .get('sess-1') as { n: number }
    expect(stageLeft.n).toBe(0)
  })

  it('deleteBySourceSession soft marks deleted', () => {
    store.upsertItem(item({
      id: 'soft-src',
      title: 'soft src',
      content: 'x',
      sourceSessionId: 'sess-soft',
    }))
    expect(store.deleteBySourceSession('sess-soft', { soft: true })).toBe(1)
    expect(store.getItem('soft-src')?.status).toBe('deleted')
  })

  it('deleteSessionScoped removes only session-scope rows', () => {
    store.upsertItem(item({
      id: 'sess-item',
      title: 'session only',
      content: 's',
      scope: 'session',
      sessionId: 's1',
    }))
    store.upsertItem(item({
      id: 'proj-item',
      title: 'project keep',
      content: 'p',
      scope: 'project',
      sourceSessionId: 's1',
    }))
    store.deleteSessionScoped('s1')
    expect(store.getItem('sess-item')).toBeUndefined()
    expect(store.getItem('proj-item')).toBeDefined()
  })

  it('nullSourceSession clears source_session_id', () => {
    store.upsertItem(item({
      id: 'n1',
      title: 'n',
      content: 'c',
      sourceSessionId: 's1',
    }))
    store.nullSourceSession('s1')
    expect(store.getItem('n1')?.sourceSessionId).toBeUndefined()
  })
})
