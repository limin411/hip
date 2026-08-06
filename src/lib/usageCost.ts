// src/lib/usageCost.ts
// Pure token→cost math for the chat usage footer/chip.
// UNIT ASSUMPTION: models.dev `CatalogModel.cost` is USD per 1,000,000 tokens.
// Honest cost (design §1.5 / KD-5): nonCached + cacheRead + cacheWrite + output, not raw input.

/** Defaults when catalog omits cache prices (design §1.5). */
export const COST_CACHE_READ_MULTIPLIER = 0.1
export const COST_CACHE_WRITE_MULTIPLIER = 1.25

/**
 * models.dev price pair (+ optional cache rates): USD per 1,000,000 tokens.
 * Catalog wire may use `cache_read` / `cache_write`; map via {@link costRateFromCatalog}.
 */
export interface CostRate {
  input: number
  output: number
  /** USD / 1e6 cache-read tokens; omit → input × cache-read multiplier. */
  cacheRead?: number
  /** USD / 1e6 cache-write tokens; omit → input × cache-write multiplier. */
  cacheWrite?: number
}

/** Minimal usage shape for cost — structurally compatible with protocol TurnUsage. */
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  nonCachedInputTokens?: number
  modelId?: string
  providerId?: string
  incomplete?: boolean
}

/** Catalog cost blob (models.dev / IPC). */
export type CatalogCost = {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
  cacheRead?: number
  cacheWrite?: number
}

const PER = 1_000_000

/**
 * Split input into billable buckets so cache tokens are not double-charged at
 * full input rate (design §1.5).
 */
export function billableInput(u: UsageTokens): {
  nonCached: number
  cacheRead: number
  cacheWrite: number
} {
  const cr = u.cacheReadTokens ?? 0
  const cw = u.cacheWriteTokens ?? 0
  if (u.nonCachedInputTokens != null) {
    return { nonCached: u.nonCachedInputTokens, cacheRead: cr, cacheWrite: cw }
  }
  // Fallback: do NOT charge full input*inputRate + cache* again
  return {
    nonCached: Math.max(0, (u.inputTokens ?? 0) - cr - cw),
    cacheRead: cr,
    cacheWrite: cw,
  }
}

/** Map models.dev / catalog cost fields into {@link CostRate}. */
export function costRateFromCatalog(cost: CatalogCost | undefined | null): CostRate | undefined {
  if (!cost || typeof cost.input !== 'number' || typeof cost.output !== 'number') return undefined
  const cacheRead = cost.cache_read ?? cost.cacheRead
  const cacheWrite = cost.cache_write ?? cost.cacheWrite
  return {
    input: cost.input,
    output: cost.output,
    ...(typeof cacheRead === 'number' ? { cacheRead } : {}),
    ...(typeof cacheWrite === 'number' ? { cacheWrite } : {}),
  }
}

export type ComputeCostOptions = {
  cacheReadMultiplier?: number
  cacheWriteMultiplier?: number
}

/**
 * Dollar cost of a usage record at the given rate, or `null` when no rate is
 * available (token-only display). Never throws.
 *
 * cost =
 *   nonCached * rate.input
 * + cacheRead * (rate.cacheRead ?? rate.input * readMult)
 * + cacheWrite * (rate.cacheWrite ?? rate.input * writeMult)
 * + output * rate.output
 *   all / 1e6
 */
export function computeCost(
  usage: UsageTokens,
  rate: CostRate | undefined,
  opts?: ComputeCostOptions,
): number | null {
  if (!rate) return null
  const readMult = opts?.cacheReadMultiplier ?? COST_CACHE_READ_MULTIPLIER
  const writeMult = opts?.cacheWriteMultiplier ?? COST_CACHE_WRITE_MULTIPLIER
  const { nonCached, cacheRead, cacheWrite } = billableInput(usage)
  const cacheReadRate = rate.cacheRead ?? rate.input * readMult
  const cacheWriteRate = rate.cacheWrite ?? rate.input * writeMult
  return (
    (nonCached * rate.input +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate +
      (usage.outputTokens ?? 0) * rate.output) /
    PER
  )
}

/**
 * Resolve catalog rate for one usage row (KD-5 / KD-22).
 * - When `modelId` is set: look up that model only; never fall back to the
 *   current session model (historical rows must not reprice on model switch).
 * - When `modelId` is missing (legacy): use `fallbackRate` (current session model).
 */
export function resolveCostRateForUsage(
  usage: Pick<UsageTokens, 'modelId' | 'providerId'>,
  catalog: {
    [providerId: string]: { models?: Record<string, { cost?: CatalogCost }> } | undefined
  },
  fallbackRate: CostRate | undefined,
): CostRate | undefined {
  const modelId = usage.modelId
  if (modelId) {
    const providerId = usage.providerId
    if (providerId) {
      const fromProvider = costRateFromCatalog(catalog[providerId]?.models?.[modelId]?.cost)
      if (fromProvider) return fromProvider
    }
    for (const p of Object.values(catalog)) {
      const rate = costRateFromCatalog(p?.models?.[modelId]?.cost)
      if (rate) return rate
    }
    // modelId present but unknown in catalog — do not use session fallback (KD-22)
    return undefined
  }
  return fallbackRate
}

/**
 * Sum dollar cost across usage rows with per-row model rates (session meter).
 * Incomplete usages still contribute their known lower-bound spend (KD-15).
 */
export function sumUsagesCost(
  usages: readonly UsageTokens[],
  catalog: {
    [providerId: string]: { models?: Record<string, { cost?: CatalogCost }> } | undefined
  },
  fallbackRate: CostRate | undefined,
  opts?: ComputeCostOptions,
): { costUsd: number | null; incomplete: boolean } {
  let sum = 0
  let anyPriced = false
  let incomplete = false
  for (const u of usages) {
    if (u.incomplete) incomplete = true
    const rate = resolveCostRateForUsage(u, catalog, fallbackRate)
    const c = computeCost(u, rate, opts)
    if (c != null) {
      anyPriced = true
      sum += c
    }
  }
  return { costUsd: anyPriced ? sum : null, incomplete }
}

/**
 * Cache hit rate for tooltip-only display (KD-21).
 * `cacheRead / (nonCached + cacheRead + cacheWrite)` when any cache field is known.
 */
export function cacheHitRate(usage: UsageTokens): number | null {
  if (usage.cacheReadTokens == null && usage.cacheWriteTokens == null) return null
  const { nonCached, cacheRead, cacheWrite } = billableInput(usage)
  const denom = nonCached + cacheRead + cacheWrite
  if (denom <= 0) return null
  return cacheRead / denom
}

/** Compact USD formatter: 4 dp, with a `<$0.0001` floor for tiny non-zero costs and `$0.00` for zero. */
export function formatUsd(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.0001) return '<$0.0001'
  return `$${cost.toFixed(4)}`
}

/** Display string: lower-bound `$…*` when incomplete (KD-15). */
export function formatUsdMaybeIncomplete(cost: number, incomplete: boolean): string {
  const base = formatUsd(cost)
  return incomplete ? `${base}*` : base
}
