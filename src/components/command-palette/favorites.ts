import type { GlobalCommand, PaletteGroup } from './types'
import { loadFavorites } from './favoritesStore'

/** Flatten all commands from groups (first occurrence wins). */
export function indexCommands(groups: PaletteGroup[]): Map<string, GlobalCommand> {
  const map = new Map<string, GlobalCommand>()
  for (const g of groups) {
    for (const item of g.items) {
      if (!map.has(item.id)) map.set(item.id, item)
    }
  }
  return map
}

/**
 * Build a Favorites group from stored ids, resolving against current groups.
 * Skips missing ids (e.g. session-specific that no longer apply).
 */
export function buildFavoritesGroup(
  groups: PaletteGroup[],
  heading: string,
  favoriteIds?: string[],
): PaletteGroup | null {
  const ids = favoriteIds ?? loadFavorites()
  if (ids.length === 0) return null
  const index = indexCommands(groups)
  const items: GlobalCommand[] = []
  for (const id of ids) {
    const cmd = index.get(id)
    if (cmd && !cmd.to) {
      // Nested-page entries (`to`) are not useful as one-shot favorites.
      items.push({ ...cmd, shortcut: undefined })
    }
  }
  if (items.length === 0) return null
  return { id: 'favorites', heading, items }
}

/** Flat list of runnable visible items (for ⌘1–9). */
export function flattenVisibleItems(groups: PaletteGroup[]): GlobalCommand[] {
  const out: GlobalCommand[] = []
  for (const g of groups) {
    for (const item of g.items) {
      out.push(item)
    }
  }
  return out
}
