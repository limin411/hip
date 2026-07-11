/** Shared ranking helpers for the global command palette. */

export type RankableItem = {
  id: string
  label: string
  keywords?: string[]
  description?: string
}

export type RankableGroup<T extends RankableItem = RankableItem> = {
  heading?: string
  id?: string
  items: T[]
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/** Score one item: 0 = no match; higher is better. */
export function scoreItem(item: RankableItem, needle: string): number {
  const label = item.label.toLowerCase()
  const keys = (item.keywords ?? []).join(' ').toLowerCase()
  const desc = (item.description ?? '').toLowerCase()
  const terms = needle.split(/\s+/).filter(Boolean)

  const termMissesAll = terms.some(
    (term) => !label.includes(term) && !keys.includes(term) && !desc.includes(term),
  )
  if (termMissesAll) return 0

  if (label === needle) return 1
  if (label.startsWith(needle)) return 0.9
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.includes(needle)) return 0.85
  if (words.some((w) => w.startsWith(needle))) return 0.8
  if (label.includes(needle)) return 0.7
  if (terms.every((term) => label.includes(term))) return 0.6
  if (terms.every((term) => label.includes(term) || keys.includes(term))) return 0.4
  // Description-only (or description completing AND) — weakest positive signal.
  if (terms.every((term) => label.includes(term) || keys.includes(term) || desc.includes(term))) {
    return 0.35
  }
  return 0.4
}

/** Order items within groups by score; drop non-matches; order groups by best item. */
export function rankGroups<T extends RankableItem>(
  groups: RankableGroup<T>[],
  search: string,
): RankableGroup<T>[] {
  const needle = normalize(search)
  if (!needle) return groups

  return groups
    .map((group) => {
      const scored = group.items
        .map((item) => ({ item, score: scoreItem(item, needle) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score)
      return {
        group: { ...group, items: scored.map((e) => e.item) },
        max: scored[0]?.score ?? 0,
      }
    })
    .filter((e) => e.max > 0)
    .sort((a, b) => b.max - a.max)
    .map((e) => e.group)
}
