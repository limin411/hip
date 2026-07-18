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

  it('upsert twice preserves original createdAt', () => {
    store.upsertItem(item({
      id: 'm-created',
      title: 'first',
      content: 'v1',
      createdAt: 100,
      updatedAt: 100,
    }))
    store.upsertItem(item({
      id: 'm-created',
      title: 'second',
      content: 'v2',
      createdAt: 999,
      updatedAt: 200,
    }))
    const got = store.getItem('m-created')
    expect(got?.createdAt).toBe(100)
    expect(got?.updatedAt).toBe(200)
    expect(got?.title).toBe('second')
    expect(got?.content).toBe('v2')
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

  it('searchInScopes keeps global/project/session OR; excludes foreign projects', () => {
    store.upsertItem(item({
      id: 'g1',
      title: 'Global hit',
      content: 'scope-token-alpha shared',
      scope: 'global',
      projectKeyHash: undefined,
    }))
    store.upsertItem(item({
      id: 'p-mine',
      title: 'My project',
      content: 'scope-token-alpha mine',
      scope: 'project',
      projectKeyHash: 'mine-hash',
    }))
    store.upsertItem(item({
      id: 'p-other',
      title: 'Other project',
      content: 'scope-token-alpha other',
      scope: 'project',
      projectKeyHash: 'other-hash',
    }))
    store.upsertItem(item({
      id: 's1',
      title: 'Session hit',
      content: 'scope-token-alpha sess',
      scope: 'session',
      sessionId: 'sess-a',
      projectKeyHash: undefined,
    }))
    store.upsertItem(item({
      id: 's-other',
      title: 'Other session',
      content: 'scope-token-alpha sess-other',
      scope: 'session',
      sessionId: 'sess-b',
      projectKeyHash: undefined,
    }))

    const hits = store.searchInScopes('scope-token-alpha', {
      projectKeyHash: 'mine-hash',
      sessionId: 'sess-a',
      limit: 10,
    })
    const ids = hits.map((h) => h.id).sort()
    expect(ids).toEqual(['g1', 'p-mine', 's1'])
  })

  it('searchInScopes LIMIT cannot be exhausted by foreign projects', () => {
    for (let i = 0; i < 40; i++) {
      store.upsertItem(item({
        id: `foreign-${i}`,
        title: `Foreign ${i}`,
        content: 'limit-token-beta foreign project',
        scope: 'project',
        projectKeyHash: 'foreign-hash',
        updatedAt: 1000 + i,
      }))
    }
    store.upsertItem(item({
      id: 'in-scope',
      title: 'In scope',
      content: 'limit-token-beta only mine',
      scope: 'global',
      projectKeyHash: undefined,
      updatedAt: 1,
    }))

    const hits = store.searchInScopes('limit-token-beta', {
      projectKeyHash: 'mine-hash',
      limit: 5,
    })
    expect(hits.map((h) => h.id)).toContain('in-scope')
    expect(hits.every((h) => h.scope === 'global' || h.projectKeyHash === 'mine-hash')).toBe(true)
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

  it('soft delete then restore returns to active list', () => {
    store.upsertItem(item({ id: 'r1', title: 'restore me', content: 'unique-restore-token-abc' }))
    expect(store.softDelete('r1')).toBe(true)
    expect(store.getItem('r1')?.status).toBe('deleted')
    expect(store.listItems({ status: 'active' }).map((i) => i.id)).not.toContain('r1')
    expect(store.listItems({ status: 'deleted' }).map((i) => i.id)).toContain('r1')

    expect(store.restoreItem('r1')).toBe(true)
    expect(store.getItem('r1')?.status).toBe('active')
    expect(store.listItems({ status: 'active' }).map((i) => i.id)).toContain('r1')
    expect(store.search('unique-restore-token-abc').map((i) => i.id)).toEqual(['r1'])
  })

  it('restoreItem is no-op for active or missing ids', () => {
    store.upsertItem(item({ id: 'active', title: 'a', content: 'c' }))
    expect(store.restoreItem('active')).toBe(false)
    expect(store.restoreItem('missing')).toBe(false)
  })

  it('purgeDeletedOlderThan removes only old trash', () => {
    const now = 1_000_000
    store.upsertItem(item({
      id: 'old-trash',
      title: 'old',
      content: 'old',
      status: 'deleted',
      updatedAt: now - 1000,
    }))
    store.upsertItem(item({
      id: 'new-trash',
      title: 'new',
      content: 'new',
      status: 'deleted',
      updatedAt: now - 10,
    }))
    store.upsertItem(item({
      id: 'still-active',
      title: 'active',
      content: 'active',
      status: 'active',
      updatedAt: now - 10_000,
    }))

    const n = store.purgeDeletedOlderThan(now - 100)
    expect(n).toBe(1)
    expect(store.getItem('old-trash')).toBeUndefined()
    expect(store.getItem('new-trash')?.status).toBe('deleted')
    expect(store.getItem('still-active')?.status).toBe('active')
  })

  it('emptyTrash hard-deletes all deleted items only', () => {
    store.upsertItem(item({ id: 't1', title: 't1', content: 'c', status: 'deleted' }))
    store.upsertItem(item({ id: 't2', title: 't2', content: 'c', status: 'deleted' }))
    store.upsertItem(item({ id: 'a1', title: 'a1', content: 'c', status: 'active' }))
    expect(store.emptyTrash()).toBe(2)
    expect(store.getItem('t1')).toBeUndefined()
    expect(store.getItem('t2')).toBeUndefined()
    expect(store.getItem('a1')).toBeDefined()
  })

  it('hardDelete removes the row', () => {
    store.upsertItem(item({ id: 'h1', title: 'gone', content: 'hard-delete-token' }))
    expect(store.hardDelete('h1')).toBe(true)
    expect(store.getItem('h1')).toBeUndefined()
  })

  it('excludes expired items from search and default list; getItem still works', () => {
    const now = 2_000_000_000_000
    store.upsertItem(
      item({
        id: 'live',
        title: 'Live expiry-token-zeta',
        content: 'expiry-token-zeta still valid',
        scope: 'global',
        projectKeyHash: undefined,
        expiresAt: now + 10_000,
      }),
    )
    store.upsertItem(
      item({
        id: 'dead',
        title: 'Dead expiry-token-zeta',
        content: 'expiry-token-zeta expired',
        scope: 'global',
        projectKeyHash: undefined,
        expiresAt: now - 1,
      }),
    )
    const hits = store.searchInScopes('expiry-token-zeta', { now, limit: 10 })
    expect(hits.map((h) => h.id)).toEqual(['live'])
    expect(store.listItems({ status: 'active', now }).map((i) => i.id)).toEqual(['live'])
    expect(store.getItem('dead')?.id).toBe('dead')
    const withExpired = store.searchInScopes('expiry-token-zeta', {
      now,
      includeExpired: true,
      limit: 10,
    })
    expect(withExpired.map((h) => h.id).sort()).toEqual(['dead', 'live'])
  })

  it('agentId filter returns shared ∪ matching agent only', () => {
    store.upsertItem(
      item({
        id: 'shared',
        title: 'Shared agent-token-omega',
        content: 'agent-token-omega shared',
        scope: 'global',
        projectKeyHash: undefined,
        agentId: undefined,
      }),
    )
    store.upsertItem(
      item({
        id: 'a-only',
        title: 'A private agent-token-omega',
        content: 'agent-token-omega for a',
        scope: 'global',
        projectKeyHash: undefined,
        agentId: 'reviewer',
      }),
    )
    store.upsertItem(
      item({
        id: 'b-only',
        title: 'B private agent-token-omega',
        content: 'agent-token-omega for b',
        scope: 'global',
        projectKeyHash: undefined,
        agentId: 'coder',
      }),
    )
    const forA = store.searchInScopes('agent-token-omega', { agentId: 'reviewer', limit: 10 })
    expect(forA.map((h) => h.id).sort()).toEqual(['a-only', 'shared'])
    const forB = store.searchInScopes('agent-token-omega', { agentId: 'coder', limit: 10 })
    expect(forB.map((h) => h.id).sort()).toEqual(['b-only', 'shared'])
    // No agent filter → all visible
    const all = store.searchInScopes('agent-token-omega', { limit: 10 })
    expect(all.map((h) => h.id).sort()).toEqual(['a-only', 'b-only', 'shared'])
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
