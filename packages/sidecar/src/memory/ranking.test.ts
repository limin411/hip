import { describe, it, expect } from 'vitest'
import type { MemoryItem } from '@hip/protocol'
import {
  kindWeight,
  keywordOverlapScore,
  rerankByQuery,
  scoreMemoryItem,
  sortByMemoryRank,
  tagOverlapScore,
  tokenizeQuery,
} from './ranking.js'

function item(partial: Partial<MemoryItem> & Pick<MemoryItem, 'id' | 'kind'>): MemoryItem {
  const now = 1_700_000_000_000
  return {
    id: partial.id,
    scope: partial.scope ?? 'global',
    kind: partial.kind,
    title: partial.title ?? partial.id,
    content: partial.content ?? 'body',
    confidence: partial.confidence ?? 0.5,
    status: 'active',
    source: 'user',
    tags: partial.tags ?? [],
    createdAt: now,
    updatedAt: partial.updatedAt ?? now,
    lastUsedAt: partial.lastUsedAt,
    useCount: partial.useCount ?? 0,
    pinned: false,
  }
}

describe('memory ranking', () => {
  const now = 1_700_000_000_000

  it('kindWeight prefers preference over lesson', () => {
    expect(kindWeight('preference')).toBeGreaterThan(kindWeight('lesson'))
  })

  it('sorts by score: high-conf preference before same-age lesson', () => {
    const a = item({ id: 'a', kind: 'preference', confidence: 0.9 })
    const b = item({ id: 'b', kind: 'lesson', confidence: 0.9 })
    const ordered = sortByMemoryRank([b, a], now)
    expect(ordered.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('useCount boosts score', () => {
    const low = item({ id: 'low', kind: 'preference', confidence: 0.5, useCount: 0 })
    const high = item({ id: 'high', kind: 'preference', confidence: 0.5, useCount: 20 })
    expect(scoreMemoryItem(high, now)).toBeGreaterThan(scoreMemoryItem(low, now))
  })

  it('tie-breaks by updatedAt then id', () => {
    const older = item({ id: 'z', kind: 'lesson', confidence: 0.8, updatedAt: now - 1000 })
    const newer = item({ id: 'a', kind: 'lesson', confidence: 0.8, updatedAt: now })
    const ordered = sortByMemoryRank([older, newer], now)
    expect(ordered[0].id).toBe('a')
  })
})

describe('query re-rank', () => {
  const now = 1_700_000_000_000

  it('tokenizeQuery drops short tokens', () => {
    expect(tokenizeQuery('Use pnpm for packages')).toEqual(['use', 'pnpm', 'for', 'packages'])
  })

  it('keyword and tag overlap prefer matching item', () => {
    const noise = item({
      id: 'noise',
      kind: 'preference',
      confidence: 0.99,
      title: 'General style',
      content: 'Prefer clean code',
    })
    const hit = item({
      id: 'hit',
      kind: 'lesson',
      confidence: 0.4,
      title: 'Package manager',
      content: 'This repo uses pnpm workspaces',
      tags: ['pnpm'],
    })
    expect(keywordOverlapScore('pnpm', hit)).toBeGreaterThan(keywordOverlapScore('pnpm', noise))
    expect(tagOverlapScore('pnpm', hit)).toBeGreaterThan(0)
    const ordered = rerankByQuery([noise, hit], 'pnpm', now)
    expect(ordered[0]!.id).toBe('hit')
  })
})
