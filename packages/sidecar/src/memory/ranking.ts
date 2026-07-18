import type { MemoryItem, MemoryKind } from '@hip/protocol'

const DAY_MS = 86_400_000

/** Keyword overlap weight for query re-rank (Mem0 multi-signal lite). */
export const QUERY_KEYWORD_WEIGHT = 0.35
/** Tag overlap weight for query re-rank. */
export const QUERY_TAG_WEIGHT = 0.2
/** Small base-position weight so original FTS/hybrid order is not fully discarded. */
export const QUERY_BASE_ORDER_WEIGHT = 0.15

const KIND_WEIGHT: Record<string, number> = {
  profile: 0.25,
  preference: 0.2,
  convention: 0.15,
  workflow: 0.1,
  lesson: 0.05,
}

export function kindWeight(kind: MemoryKind | string): number {
  return KIND_WEIGHT[kind] ?? 0.05
}

/**
 * Deterministic core ranking score (design §3.3).
 * score = confidence * 0.40 + recencyBoost + useCountBoost + kindWeight
 */
export function scoreMemoryItem(item: MemoryItem, now: number = Date.now()): number {
  const base = item.lastUsedAt ?? item.updatedAt
  const ageDays = Math.max(0, (now - base) / DAY_MS)
  const recencyBoost = 0.3 * Math.exp(-ageDays / 30)
  const useCountBoost = Math.min(0.15, Math.log1p(item.useCount) * 0.05)
  const conf = Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)) : 0
  const score = conf * 0.4 + recencyBoost + useCountBoost + kindWeight(item.kind)
  return Number.isFinite(score) ? score : 0
}

/** Sort key: score DESC, updatedAt DESC, id ASC. */
export function compareMemoryRank(a: MemoryItem, b: MemoryItem, now: number = Date.now()): number {
  const sa = scoreMemoryItem(a, now)
  const sb = scoreMemoryItem(b, now)
  if (sb !== sa) return sb - sa
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByMemoryRank(items: MemoryItem[], now: number = Date.now()): MemoryItem[] {
  return [...items].sort((a, b) => compareMemoryRank(a, b, now))
}

/** Lowercase tokens ≥2 chars (letters/digits). */
export function tokenizeQuery(q: string): string[] {
  const raw = q.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter((t) => t.length >= 2)
  return [...new Set(raw)]
}

/**
 * Fraction of query tokens that appear in title+content (0..1).
 * Empty query tokens → 0.
 */
export function keywordOverlapScore(query: string, item: MemoryItem): number {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0) return 0
  const hay = `${item.title}\n${item.content}`.toLowerCase()
  let hit = 0
  for (const t of tokens) {
    if (hay.includes(t)) hit += 1
  }
  return hit / tokens.length
}

/**
 * Fraction of query tokens that match any tag (case-insensitive) (0..1).
 */
export function tagOverlapScore(query: string, item: MemoryItem): number {
  const tokens = tokenizeQuery(query)
  if (tokens.length === 0 || !item.tags?.length) return 0
  const tags = item.tags.map((t) => t.toLowerCase())
  let hit = 0
  for (const t of tokens) {
    if (tags.some((tag) => tag === t || tag.includes(t) || t.includes(tag))) hit += 1
  }
  return hit / tokens.length
}

/**
 * Re-rank search hits with keyword + tag overlap and a light base-order prior.
 * Improves FTS-only paths when hybrid search is off.
 */
export function rerankByQuery(
  items: MemoryItem[],
  query: string,
  now: number = Date.now(),
): MemoryItem[] {
  if (items.length <= 1) return items
  const n = items.length
  const scored = items.map((item, idx) => {
    const baseOrder = 1 - idx / Math.max(n, 1)
    const kw = keywordOverlapScore(query, item)
    const tag = tagOverlapScore(query, item)
    const core = scoreMemoryItem(item, now)
    // core is typically ~0.3–1.0; scale lightly so keyword dominates for matching queries
    const score =
      QUERY_BASE_ORDER_WEIGHT * baseOrder +
      QUERY_KEYWORD_WEIGHT * kw +
      QUERY_TAG_WEIGHT * tag +
      0.15 * Math.min(1, core)
    return { item, score, idx }
  })
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.idx - b.idx
  })
  return scored.map((s) => s.item)
}
