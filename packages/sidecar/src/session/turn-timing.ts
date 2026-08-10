// packages/sidecar/src/session/turn-timing.ts
// Per-turn latency observability (G2): TTFT (time to first token), TTFM (time
// to final token), wall-clock total, and optional tool-blocking time. Pure and
// dependency-free so unit tests can drive fake clock sequences. Emitted as
// `loop.timing` events and mirrored to trace JSONL for long-task cost
// attribution.

/** Per-model-call timing snapshot. All values in milliseconds. */
export interface TurnTimingStats {
  /** Time from request start to the first streamed token (text, reasoning, or tool-call activity). */
  ttftMs: number
  /** Time from request start to the last streamed token (stream end). */
  ttfmMs: number
  /** Total wall time of the model call. */
  totalMs: number
  /** Optional: time spent blocked on tool execution (supplied by the caller). */
  toolBlockMs?: number
}

/**
 * Stopwatch for one model call. Start with `new TurnTimer()` (or `start()`);
 * `markFirstToken(now)` records TTFT (first call wins); `finish(now)` records
 * TTFM/total. `stats()` is only meaningful after `finish()`.
 */
export class TurnTimer {
  private readonly startedAt: number
  private firstTokenAt: number | null = null
  private finishedAt: number | null = null

  constructor(now = Date.now()) {
    this.startedAt = now
  }

  /** Record the first token timestamp (idempotent — first call wins). */
  markFirstToken(now = Date.now()): void {
    if (this.firstTokenAt === null) this.firstTokenAt = now
  }

  /** Record stream end. */
  finish(now = Date.now()): void {
    if (this.finishedAt === null) this.finishedAt = now
  }

  get finished(): boolean {
    return this.finishedAt !== null
  }

  /** TTFT in ms, or null when no token was ever emitted. */
  ttft(): number | null {
    if (this.firstTokenAt === null) return null
    return this.firstTokenAt - this.startedAt
  }

  stats(now = Date.now()): TurnTimingStats {
    const end = this.finishedAt ?? now
    return {
      ttftMs: this.ttft() ?? end - this.startedAt,
      ttfmMs: end - this.startedAt,
      totalMs: end - this.startedAt,
    }
  }
}

/**
 * Aggregate step timings into a per-turn summary. `toolBlockMs` accumulates
 * across steps (supplied by the caller where measurable).
 */
export function summarizeTurnTimings(
  steps: TurnTimingStats[],
  toolBlockMs = 0,
): { ttftMs: number | null; ttfmMs: number; totalMs: number; toolBlockMs: number; steps: number } {
  let totalMs = 0
  let ttfmMs = 0
  let firstTtft: number | null = null
  for (const s of steps) {
    totalMs += s.totalMs
    ttfmMs += s.ttfmMs
    if (firstTtft === null && s.ttftMs > 0) firstTtft = s.ttftMs
  }
  return {
    ttftMs: firstTtft,
    ttfmMs,
    totalMs,
    toolBlockMs,
    steps: steps.length,
  }
}
