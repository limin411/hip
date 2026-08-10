/**
 * Loop lifecycle events for internal observability (Track E / K16).
 *
 * Placement: consumed only via `GraphEmit.loopSignal` (`ctx.emit.loopSignal?.(e)`).
 * Do **not** hang a sink on `GraphCtx`. WS `loop:event` is E4 backlog — not here.
 *
 * Mapping vs SessionEvent: `loop.step` is optional enhancement and does **not** dual-write
 * `step_started` by default; LoopEvent focuses on nudge / replan / pause / budget / end.
 *
 * PR-10: compact/prefire carry optional `tokens` (by type) + hybrid/throttled tags;
 * `loop.metrics` is an end-of-turn counter snapshot for dogfood / journal.
 */

import type { LoopMetricsCounters, TokensByType } from '@hip/protocol'
import type { TurnTimingStats } from './turn-timing.js'

export type LoopNudgeReason = 'doom' | 'error_streak' | 'path_hit' | 'replan' | 'plan_exit'
export type LoopPauseKind = 'doom' | 'plan' | 'subagent_pause'
export type LoopEndReason = 'completed' | 'max_steps' | 'interrupt' | 'abort' | 'circuit_breaker'

/** Why a compact / context-management action ran. */
export type LoopCompactReason =
  | 'budget'
  | 'overflow'
  | 'overflow_secondary'
  | 'prefire'
  | 'sliding_window'
  | 'prune'
  | 'manual'

export type LoopPrefireOutcome =
  | 'started'
  | 'cached'
  | 'hit'
  | 'pass2'
  | 'miss'
  | 'skipped_disabled'
  | 'skipped_small'
  | 'skipped_inflight'
  | 'skipped_same_fp'
  | 'failed'

export type LoopEvent =
  | { type: 'loop.step'; sessionId: string; turnId: string; agentId: string; step: number; maxSteps: number }
  | { type: 'loop.nudge'; sessionId: string; turnId: string; reason: LoopNudgeReason }
  | { type: 'loop.replan'; sessionId: string; turnId: string; reason: string }
  | { type: 'loop.pause'; sessionId: string; turnId: string; question: string; kind?: LoopPauseKind }
  | {
      type: 'loop.budget'
      sessionId: string
      turnId: string
      remaining: number
      total: number
      /** Optional last-known provider token buckets (PR-10). */
      tokens?: TokensByType
    }
  | {
      type: 'loop.end'
      sessionId: string
      turnId: string
      reason: LoopEndReason
      /** Optional turn token buckets at end (PR-10). */
      tokens?: TokensByType
    }
  /** Context fill snapshot and/or compaction lifecycle (Track context-budget). */
  | {
      type: 'loop.compact'
      sessionId: string
      turnId: string
      reason: LoopCompactReason
      used?: number
      window?: number
      fillPercent?: number
      mode?: 'user-turn' | 'tool-round' | 'sliding_window' | 'prune'
      prefire?: LoopPrefireOutcome
      tokensBefore?: number
      tokensAfter?: number
      /** Whether hybrid mid-turn pressure contributed to `used` (PR-3 / KD-13). */
      hybrid?: boolean
      /** True when LLM compact was skipped due to MIN_STEPS throttle (KD-16). */
      throttled?: boolean
      /** Last provider usage buckets when known (PR-10 by_type). */
      tokens?: TokensByType
    }
  | {
      type: 'loop.prefire'
      sessionId: string
      turnId: string
      outcome: LoopPrefireOutcome
      used?: number
      window?: number
      fillPercent?: number
      /** Prefire started while over-budget but LLM compact throttled (KD-16). */
      throttled?: boolean
      /** Hybrid pressure active when prefire was evaluated (PR-3/10). */
      hybrid?: boolean
      /** Last provider usage buckets when known (PR-10 by_type). */
      tokens?: TokensByType
    }
  /**
   * End-of-turn (or mid-turn) aggregated compact/prefire counters (PR-10).
   * Built via `aggregateLoopMetrics`; does not replace individual loop.compact events.
   */
  | {
      type: 'loop.metrics'
      sessionId: string
      turnId: string
      metrics: LoopMetricsCounters
      tokens?: TokensByType
      hybrid?: boolean
    }
  /**
   * Per-step model-call timing (G2): TTFT/TTFM/total for one model call.
   * Emitted by the supervisor graph after each `runModel`; turn-level diff
   * summary rides on the final step's event via `turnDiff`.
   */
  | {
      type: 'loop.timing'
      sessionId: string
      turnId: string
      agentId: string
      step: number
      timing: TurnTimingStats
      /** Turn-level workspace diff summary, present on the last step of a turn. */
      turnDiff?: { files: number; additions: number; deletions: number }
    }

/** Sync, best-effort sink. Implementations must not throw into the agent loop. */
export type LoopEventSink = (e: LoopEvent) => void

/**
 * Invoke a loopSignal sink safely (swallows errors). No-op if sink is undefined.
 * Call sites (E1+) should prefer this over raw `sink?.(e)` when throw-safety matters.
 */
export function emitLoopSignal(sink: LoopEventSink | undefined, e: LoopEvent): void {
  if (!sink) return
  try {
    sink(e)
  } catch {
    // best-effort: never throw into the agent loop.
    // E1+: when real sinks (JSONL / debug-logger) are wired, consider a non-throwing
    // debug log or counter here — keep zero-cost when no logger is configured.
  }
}
