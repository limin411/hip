/**
 * Two-pass prefire compaction (grok-build style, simplified for hip).
 *
 * When usage approaches the auto-compact threshold (threshold − lead%),
 * speculatively summarize the would-be middle span in the background → NOTE₁.
 * When compact actually fires, reuse NOTE₁ (or merge NOTE₁ + delta) so the
 * blocking summarizer call is cheaper / skipped.
 *
 * Disable with HIP_TWO_PASS_COMPACT=0|false|off.
 */
import type { BaseMessage } from '@langchain/core/messages'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  estimateMessagesTokens,
  exceedsThreshold,
  usageFillPercent,
} from './context-budget.js'
import {
  type Summarizer,
  summarizeWithQualityGate,
} from './compaction.js'

/** Points below compact threshold where prefire starts (e.g. 85 − 10 = 75%). */
export const PREFIRE_LEAD_PERCENT = 10

/** Skip prefire when middle is too small to be worth a background LLM call. */
export const PREFIRE_MIN_MIDDLE_TOKENS = 800

/** Prefer at least this many middle messages for prefire. */
export const PREFIRE_MIN_MIDDLE_MESSAGES = 4

export function isTwoPassPrefireEnabled(): boolean {
  const v = process.env.HIP_TWO_PASS_COMPACT
  if (v === '0' || v === 'false' || v === 'off') return false
  // Default on for product; tests may disable via env.
  return true
}

export interface ShouldStartPrefireOpts {
  /**
   * KD-16: when LLM compact is throttled by MIN_STEPS, still allow prefire
   * even though used is already at/over the compact threshold.
   */
  allowOverBudget?: boolean
}

/**
 * True when fill is high enough to start background pass-1.
 * Default: between (threshold − lead) and threshold exclusive of hard compact.
 * With `allowOverBudget` (throttled LLM compact): also true at/over threshold.
 */
export function shouldStartPrefire(
  usedTokens: number,
  contextWindow: number,
  compactThresholdPercent: number = AUTO_COMPACT_THRESHOLD_PERCENT,
  leadPercent: number = PREFIRE_LEAD_PERCENT,
  opts?: ShouldStartPrefireOpts,
): boolean {
  if (contextWindow <= 0) return false
  if (exceedsThreshold(usedTokens, contextWindow, compactThresholdPercent)) {
    // At/over compact threshold: only prefire when LLM compact is throttled (KD-16).
    return opts?.allowOverBudget === true
  }
  const prefirePct = Math.max(1, compactThresholdPercent - leadPercent)
  return exceedsThreshold(usedTokens, contextWindow, prefirePct)
}

/** Stable fingerprint of a message span (ids + short content head). */
export function fingerprintMessages(messages: readonly BaseMessage[]): string {
  const parts: string[] = [String(messages.length)]
  for (const m of messages) {
    const id = m.id ?? ''
    const type = typeof m.getType === 'function' ? m.getType() : 'msg'
    let body = ''
    if (typeof m.content === 'string') body = m.content
    else if (Array.isArray(m.content)) {
      body = m.content
        .map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? '')))
        .join('')
    }
    parts.push(`${type}:${id}:${body.length}:${body.slice(0, 64)}`)
  }
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export interface PrefireNote1 {
  text: string
  fingerprint: string
  /** Number of middle messages covered by this note. */
  prefixLen: number
  createdAt: number
}

export type PrefireOutcome =
  | 'cached'
  | 'started'
  | 'skipped_disabled'
  | 'skipped_small'
  | 'skipped_inflight'
  | 'skipped_same_fp'
  | 'failed'

/**
 * Session/graph-scoped prefire cache. Mutable; shared across compactNode visits
 * within one graph invoke via GraphCtx.
 */
export class PrefireCache {
  note1: PrefireNote1 | null = null
  private inflight: Promise<void> | null = null
  private lastStartedFp: string | null = null

  clear(): void {
    this.note1 = null
    this.lastStartedFp = null
    // leave inflight running; result will be ignored if fingerprint mismatches
  }

  /**
   * Fire-and-forget pass-1. Never throws. Idempotent for the same fingerprint.
   */
  startPass1(
    middle: BaseMessage[],
    summarizer: Summarizer,
    opts?: { sessionId?: string; focus?: string },
  ): PrefireOutcome {
    if (!isTwoPassPrefireEnabled()) return 'skipped_disabled'
    if (middle.length < PREFIRE_MIN_MIDDLE_MESSAGES) return 'skipped_small'
    if (estimateMessagesTokens(middle) < PREFIRE_MIN_MIDDLE_TOKENS) return 'skipped_small'
    if (this.inflight) return 'skipped_inflight'

    const fp = fingerprintMessages(middle)
    if (this.note1?.fingerprint === fp) return 'cached'
    if (this.lastStartedFp === fp) return 'skipped_same_fp'

    this.lastStartedFp = fp
    const prefixLen = middle.length
    const sessionId = opts?.sessionId
    const focus = opts?.focus

    this.inflight = (async () => {
      try {
        const text = await summarizeWithQualityGate(middle, {
          summarizer,
          ...(focus ? { focus } : {}),
          ...(sessionId ? { sessionId } : {}),
        })
        // Only commit if still the latest started fingerprint.
        if (this.lastStartedFp === fp && text.trim()) {
          this.note1 = {
            text: text.trim(),
            fingerprint: fp,
            prefixLen,
            createdAt: Date.now(),
          }
        }
      } catch {
        // swallow
      } finally {
        this.inflight = null
      }
    })()

    // Don't keep process alive solely for prefire.
    void this.inflight.catch(() => {})
    return 'started'
  }

  /**
   * If NOTE₁ is still valid for the current middle (exact fingerprint match, or
   * prefix of middle matches the prefired span), return it with any uncovered
   * delta messages for pass-2.
   */
  match(middle: BaseMessage[]): { note1: string; delta: BaseMessage[] } | null {
    if (!this.note1 || !this.note1.text.trim()) return null
    const n = this.note1
    if (middle.length < n.prefixLen) {
      // History shrank / rewound — invalidate.
      this.note1 = null
      return null
    }
    const prefix = middle.slice(0, n.prefixLen)
    if (fingerprintMessages(prefix) !== n.fingerprint) {
      this.note1 = null
      return null
    }
    return {
      note1: n.text,
      delta: middle.slice(n.prefixLen),
    }
  }

  /** Await inflight pass-1 briefly when compact is about to run (best-effort). */
  async awaitInflight(timeoutMs: number = 2_000): Promise<void> {
    if (!this.inflight) return
    await Promise.race([
      this.inflight,
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, timeoutMs)
        if (typeof (t as NodeJS.Timeout).unref === 'function') (t as NodeJS.Timeout).unref()
      }),
    ])
  }
}

/**
 * Build pass-2 summarizer input: NOTE₁ + optional delta messages.
 * When delta is empty, the caller can use note1 directly without another LLM call.
 */
export { buildPass2SeedMessages } from './compaction.js'

export function prefireFillDebug(
  used: number,
  window: number,
): { fillPercent: number; used: number; window: number } {
  return { fillPercent: usageFillPercent(used, window), used, window }
}
