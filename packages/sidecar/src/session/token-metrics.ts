/**
 * Rich token metrics helpers (PR-10 / G16).
 *
 * Pure functions over TurnUsage + LoopEvent streams for dogfood journal tags,
 * `context:breakdown` payloads, and optional loop.* event tags.
 */
import type {
  ContextBreakdownSnapshot,
  LoopMetricsCounters,
  TokensByType,
  TurnUsage,
} from '@hip/protocol'
import type { LoopEvent } from './loop-events.js'
import { stepContextTokens } from './usage.js'

/** Extract by-type buckets from a TurnUsage (omit zero optional cache/reasoning). */
export function tokensByType(u: TurnUsage | null | undefined): TokensByType | undefined {
  if (!u) return undefined
  const out: TokensByType = {
    input: Math.max(0, Math.floor(u.inputTokens || 0)),
    output: Math.max(0, Math.floor(u.outputTokens || 0)),
  }
  if (u.cacheReadTokens != null && u.cacheReadTokens > 0) out.cacheRead = u.cacheReadTokens
  if (u.cacheWriteTokens != null && u.cacheWriteTokens > 0) out.cacheWrite = u.cacheWriteTokens
  if (u.reasoningTokens != null && u.reasoningTokens > 0) out.reasoning = u.reasoningTokens
  return out
}

export function emptyLoopMetricsCounters(): LoopMetricsCounters {
  return {
    compactCount: 0,
    overflowRecoveries: 0,
    llmCompacts: 0,
    prunes: 0,
    slidingWindows: 0,
    prefireStarted: 0,
    prefireHit: 0,
    prefireMiss: 0,
    hybridCompacts: 0,
    throttledCompacts: 0,
    throttledPrefires: 0,
  }
}

/** LLM compact reasons that are not pure structural prune / window. */
const LLM_COMPACT_REASONS = new Set([
  'budget',
  'overflow',
  'overflow_secondary',
  'prefire',
  'manual',
])

/** Fold one LoopEvent into counters (immutable return). */
export function accumulateLoopMetrics(
  acc: LoopMetricsCounters,
  e: LoopEvent,
): LoopMetricsCounters {
  if (e.type === 'loop.compact') {
    const next = { ...acc, compactCount: acc.compactCount + 1 }
    if (e.reason === 'overflow' || e.reason === 'overflow_secondary') {
      next.overflowRecoveries = acc.overflowRecoveries + 1
    }
    if (e.reason === 'prune') next.prunes = acc.prunes + 1
    if (e.reason === 'sliding_window') next.slidingWindows = acc.slidingWindows + 1
    if (LLM_COMPACT_REASONS.has(e.reason)) next.llmCompacts = acc.llmCompacts + 1
    if (e.hybrid) next.hybridCompacts = acc.hybridCompacts + 1
    if (e.throttled) next.throttledCompacts = acc.throttledCompacts + 1
    return next
  }
  if (e.type === 'loop.prefire') {
    const next = { ...acc }
    if (e.outcome === 'started') next.prefireStarted = acc.prefireStarted + 1
    if (e.outcome === 'hit' || e.outcome === 'cached' || e.outcome === 'pass2') {
      next.prefireHit = acc.prefireHit + 1
    }
    if (e.outcome === 'miss' || e.outcome === 'failed') {
      next.prefireMiss = acc.prefireMiss + 1
    }
    if (e.throttled) next.throttledPrefires = acc.throttledPrefires + 1
    return next
  }
  return acc
}

/** Aggregate compact / prefire tags from a loop event stream. */
export function aggregateLoopMetrics(events: ReadonlyArray<LoopEvent>): LoopMetricsCounters {
  let acc = emptyLoopMetricsCounters()
  for (const e of events) acc = accumulateLoopMetrics(acc, e)
  return acc
}

/**
 * Build a `context:breakdown` payload from provider usage (+ optional segments / metrics).
 * Never invents token counts — optional fields omitted when unknown.
 */
export function buildContextBreakdownSnapshot(opts: {
  usage?: TurnUsage | null
  inputBudget?: number
  segments?: ContextBreakdownSnapshot['segments']
  coarseSegments?: ContextBreakdownSnapshot['coarseSegments']
  metrics?: LoopMetricsCounters
  hybrid?: boolean
  turnId?: string
}): ContextBreakdownSnapshot {
  const fromUsage = opts.usage ? stepContextTokens(opts.usage) : 0
  const inputBudget =
    opts.inputBudget != null && opts.inputBudget > 0
      ? opts.inputBudget
      : fromUsage > 0
        ? fromUsage
        : opts.usage?.inputTokens ?? 0
  const byType = tokensByType(opts.usage ?? undefined)
  return {
    inputBudget,
    ...(opts.segments && opts.segments.length > 0 ? { segments: opts.segments } : {}),
    ...(opts.coarseSegments && opts.coarseSegments.length > 0
      ? { coarseSegments: opts.coarseSegments }
      : {}),
    ...(byType ? { tokensByType: byType } : {}),
    ...(opts.metrics ? { metrics: opts.metrics } : {}),
    ...(opts.hybrid ? { hybrid: true } : {}),
    ...(opts.turnId ? { turnId: opts.turnId } : {}),
  }
}
