/** Compute token usage as a percentage of the context window (0-100).
 *  Returns null when usedTokens is null/undefined or contextWindow is missing/0. */
export function computePercentage(
  usedTokens: number | null,
  contextWindow: number | undefined,
): number | null {
  if (usedTokens == null || !contextWindow) return null
  return Math.max(0, Math.min(100, Math.round((usedTokens / contextWindow) * 100)))
}

/** Map a percentage to a semantic color zone using existing CSS color tokens.
 *  Returns null when percent is null. */
export function zoneForPercent(percent: number | null): 'success' | 'warning' | 'danger' | null {
  if (percent === null) return null
  if (percent < 50) return 'success'
  if (percent < 80) return 'warning'
  return 'danger'
}
