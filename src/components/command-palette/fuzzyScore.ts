/**
 * Character-level fuzzy (subsequence) score for command palette ranking.
 * Returns 0 if needle is not a subsequence of haystack; otherwise (0, 0.65].
 */

export type FuzzyMatch = {
  score: number
  /** Indices into the original haystack (case-insensitive match positions). */
  indices: number[]
}

/** Subsequence match with a light bonus for consecutive hits. */
export function fuzzyMatch(haystack: string, needle: string): FuzzyMatch {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase().replace(/\s+/g, '')
  if (!n) return { score: 0, indices: [] }
  if (n.length > h.length) return { score: 0, indices: [] }

  const indices: number[] = []
  let hi = 0
  let consecutive = 0
  let raw = 0

  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni]
    let found = -1
    for (let j = hi; j < h.length; j++) {
      if (h[j] === ch) {
        found = j
        break
      }
    }
    if (found < 0) return { score: 0, indices: [] }
    if (indices.length > 0 && found === indices[indices.length - 1] + 1) {
      consecutive += 1
    } else {
      consecutive = 1
    }
    raw += 1 + consecutive * 0.15
    indices.push(found)
    hi = found + 1
  }

  // Density: earlier / tighter matches score higher.
  const span = indices[indices.length - 1]! - indices[0]! + 1
  const density = n.length / span
  const maxRaw = n.length * (1 + 0.15 * n.length)
  const normalized = (raw / maxRaw) * 0.55 + density * 0.1
  const score = Math.min(0.65, Math.max(0.05, normalized))
  return { score, indices }
}

/** Contiguous substring indices in haystack for needle (first match), or []. */
export function substringIndices(haystack: string, needle: string): number[] {
  if (!needle) return []
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const i = h.indexOf(n)
  if (i < 0) return []
  return Array.from({ length: n.length }, (_, k) => i + k)
}

/**
 * Best highlight indices for a label given a search string.
 * Prefers contiguous substring of the full needle (sans multi-space), else fuzzy.
 */
export function matchHighlightIndices(label: string, search: string): number[] {
  const needle = search.trim()
  if (!needle) return []
  const compact = needle.replace(/\s+/g, ' ')
  const sub = substringIndices(label, compact)
  if (sub.length > 0) return sub
  // try first term contiguous
  const first = compact.split(/\s+/)[0] ?? ''
  const subFirst = substringIndices(label, first)
  if (subFirst.length > 0) return subFirst
  return fuzzyMatch(label, compact).indices
}
