/**
 * Loop lifecycle events for internal observability (Track E / K16).
 *
 * Placement: consumed only via `GraphEmit.loopSignal` (`ctx.emit.loopSignal?.(e)`).
 * Do **not** hang a sink on `GraphCtx`. WS `loop:event` is E4 backlog — not here.
 *
 * Mapping vs SessionEvent: `loop.step` is optional enhancement and does **not** dual-write
 * `step_started` by default; LoopEvent focuses on nudge / replan / pause / budget / end.
 */

export type LoopNudgeReason = 'doom' | 'error_streak' | 'path_hit' | 'replan'
export type LoopPauseKind = 'doom' | 'plan' | 'subagent_pause'
export type LoopEndReason = 'completed' | 'max_steps' | 'interrupt' | 'abort' | 'circuit_breaker'

export type LoopEvent =
  | { type: 'loop.step'; sessionId: string; turnId: string; agentId: string; step: number; maxSteps: number }
  | { type: 'loop.nudge'; sessionId: string; turnId: string; reason: LoopNudgeReason }
  | { type: 'loop.replan'; sessionId: string; turnId: string; reason: string }
  | { type: 'loop.pause'; sessionId: string; turnId: string; question: string; kind?: LoopPauseKind }
  | { type: 'loop.budget'; sessionId: string; turnId: string; remaining: number; total: number }
  | { type: 'loop.end'; sessionId: string; turnId: string; reason: LoopEndReason }

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
    // best-effort: never throw into the agent loop
  }
}
