import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MemoryItem } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import {
  cosine,
  hybridScore,
  searchHybrid,
  DEFAULT_HYBRID_WEIGHTS,
  maybeRerank,
} from './hybrid-search.js'
import { upsertEmbedding } from './vec.js'

function baseItem(partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'title' | 'content'>): MemoryItem {
  return {
    scope: 'global',
    kind: 'lesson',
    confidence: 0.5,
    status: 'active',
    source: 'user',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    useCount: 0,
    pinned: false,
    ...partial,
  }
}

describe('cosine / hybridScore', () => {
  it('cosine is 1 for identical unit vectors, 0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([], [1])).toBe(0)
    expect(cosine([1, 0], [1])).toBe(0)
  })

  it('hybridScore uses default weights αβγδε', () => {
    expect(DEFAULT_HYBRID_WEIGHTS).toEqual({
      alpha: 0.35,
      beta: 0.4,
      gamma: 0.15,
      delta: 0.05,
      epsilon: 0.05,
    })
    const s = hybridScore({
      ftsRankNorm: 1,
      cosineSim: 1,
      confidence: 1,
      recency: 1,
      pinned: true,
    })
    expect(s).toBeCloseTo(0.35 + 0.4 + 0.15 + 0.05 + 0.05)
  })
})

describe('searchHybrid', () => {
  let store: MemoryStore
  let db: ReturnType<typeof openDatabase>['db']

  beforeEach(() => {
    const opened = openDatabase(':memory:')
    db = opened.db
    store = new MemoryStore(db, opened.memoriesFtsEnabled, opened.memoriesVecEnabled)
  })

  it('with mock query vector ranks semantic neighbor above FTS-only noise', async () => {
    // Shared token so both appear in FTS; order may put noise first.
    const noise = baseItem({
      id: 'noise',
      title: 'noise package package package',
      content: 'package management noise filler package package',
      confidence: 0.9,
      updatedAt: Date.now(),
    })
    const neighbor = baseItem({
      id: 'neighbor',
      title: 'Yarn tip',
      content: 'package management prefers yarn workspaces',
      confidence: 0.5,
      updatedAt: 1,
    })
    store.upsertItem(noise)
    store.upsertItem(neighbor)

    const qVec = [1, 0, 0]
    upsertEmbedding(db, {
      memoryId: 'neighbor',
      modelKey: 'test/emb',
      embedding: [0.99, 0.01, 0],
    })
    upsertEmbedding(db, {
      memoryId: 'noise',
      modelKey: 'test/emb',
      embedding: [0, 1, 0],
    })

    const hits = await searchHybrid({
      store,
      query: 'package management',
      limit: 10,
      embedQuery: async () => qVec,
      getEmbedding: (id) => {
        if (id === 'neighbor') return [0.99, 0.01, 0]
        if (id === 'noise') return [0, 1, 0]
        return null
      },
      now: Date.now(),
    })
    expect(hits.map((h) => h.id)[0]).toBe('neighbor')
  })

  it('no query vec → FTS order only (slice to limit)', async () => {
    store.upsertItem(
      baseItem({ id: 'a', title: 'alpha token', content: 'alpha token body' }),
    )
    store.upsertItem(
      baseItem({ id: 'b', title: 'beta token', content: 'beta token body' }),
    )
    const fts = store.searchInScopes('token', { limit: 10 })
    const hybrid = await searchHybrid({
      store,
      query: 'token',
      limit: 10,
      embedQuery: async () => null,
      getEmbedding: () => null,
    })
    expect(hybrid.map((h) => h.id)).toEqual(fts.map((h) => h.id))
  })
})

describe('MemoryService hybrid wiring', () => {
  let dir: string
  let configPath: string
  let store: MemoryStore
  let svc: MemoryService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-hybrid-'))
    configPath = join(dir, 'memory.json')
    const opened = openDatabase(':memory:')
    store = new MemoryStore(opened.db, opened.memoriesFtsEnabled, opened.memoriesVecEnabled)
    svc = new MemoryService(store, {
      configPath,
      createEmbeddingClient: () => ({
        async embed(texts: string[]) {
          // Bare query phrase → semantic axis; yarn items near query; keyword-noise orthogonal.
          return texts.map((t) => {
            const s = t.trim()
            if (s === 'package management' || s === 'package management\n') {
              return [1, 0, 0]
            }
            if (s.includes('Yarn') || s.includes('yarn')) return [0.99, 0.01, 0]
            return [0, 1, 0]
          })
        },
      }),
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('hybrid off uses FTS path (searchScoped equals searchInScopes order)', async () => {
    store.upsertItem(
      baseItem({
        id: 'm1',
        title: 'Yarn tip',
        content: 'Always use yarn for package management',
      }),
    )
    svc.setConfig({ hybridSearchEnabled: false })
    const fts = store.searchInScopes('package management', { limit: 30 })
    const scoped = await svc.searchScoped('package management', { limit: 30 })
    expect(scoped.map((x) => x.id)).toEqual(fts.map((x) => x.id))
  })

  it('setConfig hybrid without embedding fails', () => {
    expect(() =>
      svc.setConfig({ hybridSearchEnabled: true }),
    ).toThrow(/embeddingModel/i)
    expect(svc.getConfig().hybridSearchEnabled).toBe(false)
  })

  it('hybrid on + embeddings ranks semantic neighbor higher in formatPrefetch', async () => {
    svc.setConfig({
      embeddingModel: { providerID: 'openai', modelID: 'text-embedding-3-small' },
      hybridSearchEnabled: true,
    })
    const noise = svc.upsert({
      id: 'noise',
      title: 'package package package noise',
      content: 'package management package package filler',
      kind: 'lesson',
      scope: 'global',
      confidence: 0.95,
    })
    const neighbor = svc.upsert({
      id: 'neighbor',
      title: 'Yarn tip',
      content: 'package management prefers yarn',
      kind: 'lesson',
      scope: 'global',
      confidence: 0.4,
    })
    await svc.scheduleEmbed(noise.id)
    await svc.scheduleEmbed(neighbor.id)

    const block = await svc.formatPrefetch('package management', undefined, undefined)
    expect(block.text).toContain('Yarn tip')
    // Neighbor line should appear before noise when hybrid reorders.
    const yarnIdx = block.text.indexOf('Yarn tip')
    const noiseIdx = block.text.indexOf('package package package noise')
    expect(yarnIdx).toBeGreaterThanOrEqual(0)
    if (noiseIdx >= 0) {
      expect(yarnIdx).toBeLessThan(noiseIdx)
    }
  })
})

describe('maybeRerank', () => {
  it('pass-through when rerankModel unset or set', () => {
    const items = [baseItem({ id: 'a', title: 'a', content: 'a' })]
    expect(maybeRerank(items, { query: 'q' })).toEqual(items)
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(
      maybeRerank(items, {
        query: 'q',
        rerankModel: { providerID: 'openai', modelID: 'rerank-x' },
      }),
    ).toEqual(items)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
