import type { ContextKind, ContextMenuItemMeta } from './types'

/**
 * Authoritative static meta for prefs / Settings UI.
 * Hand-maintained; surface PRs (message, tabs, file tree, …) append entries here.
 * Empty in PR-1 foundation — no production items until providers land.
 */
const CATALOG: ContextMenuItemMeta[] = []

/** Register static meta (module init or tests). Dedupes by id. Returns unregister. */
export function registerCatalogMeta(items: ContextMenuItemMeta[]): () => void {
  const added: ContextMenuItemMeta[] = []
  for (const item of items) {
    if (!item.id) continue
    if (CATALOG.some((c) => c.id === item.id)) continue
    CATALOG.push(item)
    added.push(item)
  }
  return () => {
    for (const item of added) {
      const i = CATALOG.findIndex((c) => c.id === item.id)
      if (i >= 0) CATALOG.splice(i, 1)
    }
  }
}

/** Test helper: clear all catalog meta. */
export function clearCatalogMeta(): void {
  CATALOG.length = 0
}

/** List static catalog entries, optionally filtered by kind. */
export function listCatalogItems(kind?: ContextKind): ContextMenuItemMeta[] {
  if (kind === undefined) return CATALOG.slice()
  return CATALOG.filter((m) => m.kind === kind)
}
