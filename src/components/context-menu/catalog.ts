import type { ContextKind, ContextMenuItemMeta } from './types'

/**
 * Authoritative hand-maintained static meta for prefs / Settings UI.
 * Surface PRs (message, tabs, file tree, …) append entries here.
 * Never cleared by tests — only `extraMeta` is mutable for register/clear.
 * Empty in PR-1 foundation — no production items until providers land.
 */
const STATIC_CATALOG: ContextMenuItemMeta[] = []

/** Test / in-app extras only. Cleared by clearCatalogMeta. */
const extraMeta: ContextMenuItemMeta[] = []

function staticIds(): Set<string> {
  return new Set(STATIC_CATALOG.map((m) => m.id))
}

/** Register extra meta (tests or dynamic modules). Dedupes by id (static wins). Returns unregister. */
export function registerCatalogMeta(items: ContextMenuItemMeta[]): () => void {
  const known = new Set<string>([...staticIds(), ...extraMeta.map((m) => m.id)])
  const added: ContextMenuItemMeta[] = []
  for (const item of items) {
    if (!item.id || known.has(item.id)) continue
    known.add(item.id)
    extraMeta.push(item)
    added.push(item)
  }
  return () => {
    for (const item of added) {
      const i = extraMeta.findIndex((c) => c.id === item.id)
      if (i >= 0) extraMeta.splice(i, 1)
    }
  }
}

/** Test helper: clear extra catalog meta only. Static catalog is never wiped. */
export function clearCatalogMeta(): void {
  extraMeta.length = 0
}

/** List catalog entries (static + extras), optionally filtered by kind. Static wins on id collision. */
export function listCatalogItems(kind?: ContextKind): ContextMenuItemMeta[] {
  const seen = staticIds()
  const all = [
    ...STATIC_CATALOG,
    ...extraMeta.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    }),
  ]
  if (kind === undefined) return all.slice()
  return all.filter((m) => m.kind === kind)
}
