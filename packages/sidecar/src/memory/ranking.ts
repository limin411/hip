import type { MemoryItem, MemoryKind } from '@hip/protocol'

const DAY_MS = 86_400_000

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
