/** Core (frozen summary) injection char budget. */
export function getMemoryCoreBudget(configMax: number, contextWindowTokens?: number): number {
  const tokens = contextWindowTokens ?? 128_000
  const dynamic = Math.floor(tokens * 0.005 * 4)
  return Math.min(configMax, dynamic, 1500)
}

/** Prefetch (dynamic FTS hits) injection char budget. */
export function getMemoryPrefetchBudget(configMax: number, contextWindowTokens?: number): number {
  const tokens = contextWindowTokens ?? 128_000
  const dynamic = Math.floor(tokens * 0.008 * 4)
  return Math.min(configMax, dynamic, 2500)
}
