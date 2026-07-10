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

  it('returns 0 when a term matches neither label nor keywords', () => {
    expect(scoreItem(items[0], 'zzz')).toBe(0)
  })

  it('matches keywords alone at lower score', () => {
    expect(scoreItem(items[0], 'config')).toBe(0.4)
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
