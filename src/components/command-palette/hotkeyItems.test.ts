import { describe, it, expect } from 'vitest'
import { flattenHotkeyItems, hotkeyIndexForId } from './hotkeyItems'
import type { GlobalCommand, PaletteGroup } from './types'

const run = (id: string): GlobalCommand => ({
  id,
  label: id,
  group: 'actions',
  run: () => {},
})

const nest = (id: string, to: 'theme' | 'model' | 'sessions'): GlobalCommand => ({
  id,
  label: id,
  group: 'appearance',
  to,
})

describe('flattenHotkeyItems', () => {
  it('skips nested to items and preserves order of runnables', () => {
    const groups: PaletteGroup[] = [
      {
        id: 'appearance',
        items: [nest('appearance-theme', 'theme'), run('a1'), run('a2')],
      },
      { id: 'actions', items: [run('a3')] },
    ]
    expect(flattenHotkeyItems(groups).map((c) => c.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('returns empty when only nested items', () => {
    const groups: PaletteGroup[] = [{ id: 'a', items: [nest('t', 'theme')] }]
    expect(flattenHotkeyItems(groups)).toEqual([])
  })
})

describe('hotkeyIndexForId', () => {
  it('returns 1-based index capped at 9', () => {
    const items = Array.from({ length: 12 }, (_, i) => run(`x${i}`))
    expect(hotkeyIndexForId(items, 'x0')).toBe(1)
    expect(hotkeyIndexForId(items, 'x8')).toBe(9)
    expect(hotkeyIndexForId(items, 'x9')).toBeUndefined()
    expect(hotkeyIndexForId(items, 'missing')).toBeUndefined()
  })
})
