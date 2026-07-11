import { describe, it, expect } from 'vitest'
import { rankGroups, scoreItem, type RankableItem } from './rankGlobalCommands'

const items: RankableItem[] = [
  { id: 'settings', label: 'Open settings', keywords: ['prefs', 'config'] },
  { id: 'tools', label: 'Tools', keywords: ['capabilities'] },
  { id: 'theme', label: 'Theme', keywords: ['appearance'] },
]

describe('scoreItem', () => {
  it('scores exact label highest', () => {
    expect(scoreItem(items[1], 'tools')).toBe(1)
  })

  it('returns 0 when a term matches neither label nor keywords nor description', () => {
    expect(scoreItem(items[0], 'zzz')).toBe(0)
  })

  it('matches keywords alone at lower score', () => {
    expect(scoreItem(items[0], 'config')).toBe(0.4)
  })

  it('matches description at weak score', () => {
    const score = scoreItem(
      { id: 'x', label: 'Foo', description: 'Open memory settings' },
      'memory',
    )
    expect(score).toBe(0.35)
  })

  it('fuzzy-matches non-contiguous label chars', () => {
    const score = scoreItem({ id: '1', label: 'Set Syntax Markdown' }, 'ssmd')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(0.65)
  })
})

describe('rankGroups with usage', () => {
  it('boosts frequently used matches', () => {
    const groups = [
      {
        items: [
          { id: 'a', label: 'Alpha tools' },
          { id: 'b', label: 'Beta tools' },
        ],
      },
    ]
    const ranked = rankGroups(groups, 'tools', {
      usage: { b: { count: 20, lastUsedAtMs: Date.now() } },
    })
    expect(ranked[0]?.items[0]?.id).toBe('b')
  })
})

describe('rankGroups', () => {
  it('returns original groups when search is empty', () => {
    const groups = [{ heading: 'Nav', items }]
    expect(rankGroups(groups, '')).toEqual(groups)
  })

  it('filters and orders by score', () => {
    const groups = [
      { heading: 'A', items: [items[0], items[2]] },
      { heading: 'B', items: [items[1]] },
    ]
    const ranked = rankGroups(groups, 'tools')
    expect(ranked).toHaveLength(1)
    expect(ranked[0].items[0].id).toBe('tools')
  })

  it('requires every term (AND)', () => {
    const groups = [{ items }]
    expect(rankGroups(groups, 'open missing')).toEqual([])
    expect(rankGroups(groups, 'open settings')[0]?.items[0].id).toBe('settings')
  })
})
