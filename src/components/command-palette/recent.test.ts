import { describe, it, expect } from 'vitest'
import { buildRecentGroup } from './recent'
import type { PaletteGroup } from './types'

const groups: PaletteGroup[] = [
  {
    id: 'actions',
    items: [
      { id: 'action-new-conversation', label: 'New', group: 'actions', run: () => {} },
      { id: 'appearance-theme', label: 'Theme', group: 'appearance', to: 'theme' },
      { id: 'ctx-compact', label: 'Compact', group: 'context', run: () => {} },
    ],
  },
]

describe('buildRecentGroup', () => {
  it('orders by lastUsedAtMs and skips drill-in rows', () => {
    const recent = buildRecentGroup(groups, 'Recent', {
      'appearance-theme': { count: 9, lastUsedAtMs: 300 },
      'ctx-compact': { count: 1, lastUsedAtMs: 200 },
      'action-new-conversation': { count: 2, lastUsedAtMs: 100 },
      missing: { count: 5, lastUsedAtMs: 400 },
    })
    expect(recent?.items.map((i) => i.id)).toEqual(['ctx-compact', 'action-new-conversation'])
  })

  it('returns null when nothing resolves', () => {
    expect(buildRecentGroup(groups, 'Recent', {})).toBeNull()
  })
})
