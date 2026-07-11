// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { isFavorite, loadFavorites, toggleFavorite, setFavorites } from './favoritesStore'
import { buildFavoritesGroup } from './favorites'
import type { PaletteGroup } from './types'

beforeEach(() => {
  localStorage.clear()
})

describe('favoritesStore', () => {
  it('toggles favorites', () => {
    expect(isFavorite('nav-settings')).toBe(false)
    toggleFavorite('nav-settings')
    expect(isFavorite('nav-settings')).toBe(true)
    expect(loadFavorites()).toEqual(['nav-settings'])
    toggleFavorite('nav-settings')
    expect(isFavorite('nav-settings')).toBe(false)
  })

  it('setFavorites replaces list', () => {
    setFavorites(['a', 'b', 'a'])
    expect(loadFavorites()).toEqual(['a', 'b'])
  })
})

describe('buildFavoritesGroup', () => {
  it('resolves ids from groups', () => {
    const groups: PaletteGroup[] = [
      {
        id: 'navigation',
        items: [
          { id: 'nav-settings', label: 'Settings', group: 'navigation', run: () => {} },
          { id: 'nav-chat', label: 'Chat', group: 'navigation', run: () => {} },
        ],
      },
    ]
    const fav = buildFavoritesGroup(groups, 'Favorites', ['nav-chat', 'missing'])
    expect(fav?.items.map((i) => i.id)).toEqual(['nav-chat'])
  })
})
