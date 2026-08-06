/**
 * Context-window threshold / fill helpers (pure integer arithmetic where gates matter).
 *
 * Gate modes (KD-3):
 * - percent (default): used*100 >= window*pct  — buffer ignored when 0 / unused
 * - percent_minus_buffer: used*100 >= window*pct - buffer*100  (NOT default)
 * - usable: used against (window - buffer) * pct/100  (OC-inspired)
 *
 * Misconfiguration note: when buffer ≥ window (or buffer*100 ≥ window*pct),
 * the gate treats the context as always over budget (boundary clamped to 0 /
 * usable width 0 → fire). Defaults keep buffer=0 so this only hits intentional
 * or extreme small-window configs.
 */
import { DEFAULT_OUTPUT_BUFFER_CAP } from './constants.js'

/** Context pressure gate mode for auto-compact. Default product path: percent. */
export type ContextGateMode = 'percent' | 'usable' | 'percent_minus_buffer'

/**
 * Clamp a threshold percent into [0, 100] with Math.round.
 * Shared by gates and trigger-token helpers so fractional percents agree.
 */
export function clampThresholdPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * True when `used >= contextWindow * thresholdPercent / 100`.
 * Integer: used*100 >= window*pct. False when window <= 0.
 */
export function exceedsThreshold(
  used: number,
  contextWindow: number,
  thresholdPercent: number,
): boolean {
  if (contextWindow <= 0) return false
  const pct = clampThresholdPercent(thresholdPercent)
  return used * 100 >= contextWindow * pct
}

/**
 * GB headroom form: used*100 >= window*pct - buffer*100
 * (equivalent to used >= window*pct/100 - buffer).
 * When bufferTokens is 0, matches {@link exceedsThreshold}.
 * False when window <= 0.
 * Boundary is clamped to ≥0: buffer dominating the threshold ⇒ always over budget
 * (including used=0). Safe with default buffer=0.
 */
export function exceedsThresholdWithBuffer(
  used: number,
  contextWindow: number,
  thresholdPercent: number,
  bufferTokens: number,
): boolean {
  if (contextWindow <= 0) return false
  const pct = clampThresholdPercent(thresholdPercent)
  const buffer = Math.max(0, Math.floor(bufferTokens) || 0)
  const boundary = Math.max(0, contextWindow * pct - buffer * 100)
  return used * 100 >= boundary
}

/**
 * OC-inspired usable context width: window minus reserved output buffer.
 * `reserved = min(bufferCap, maxOutput ?? bufferCap)` clamped to [0, window].
 * Default bufferCap = 20_000 (design).
 */
export function usableContextTokens(
  contextWindow: number,
  maxOutput?: number | null,
  bufferCap: number = DEFAULT_OUTPUT_BUFFER_CAP,
): number {
  if (contextWindow <= 0) return 0
  const cap = Math.max(0, Math.floor(bufferCap) || 0)
  let reserved = cap
  if (maxOutput != null && Number.isFinite(maxOutput) && maxOutput >= 0) {
    reserved = Math.min(reserved, Math.floor(maxOutput))
  }
  reserved = Math.min(reserved, contextWindow)
  return Math.max(0, contextWindow - reserved)
}

/**
 * Usable width when `outputBufferTokens` is the configured reservation
 * (optionally capped by maxOutput and/or an absolute cap).
 */
export function usableContextTokensFromBuffer(
  contextWindow: number,
  bufferTokens: number,
  maxOutput?: number | null,
): number {
  if (contextWindow <= 0) return 0
  let reserved = Math.max(0, Math.floor(bufferTokens) || 0)
  if (maxOutput != null && Number.isFinite(maxOutput) && maxOutput >= 0) {
    reserved = Math.min(reserved, Math.floor(maxOutput))
  }
  reserved = Math.min(reserved, contextWindow)
  return Math.max(0, contextWindow - reserved)
}

export interface ExceedsGateOptions {
  gateMode?: ContextGateMode
  /** Absolute headroom tokens (outputBufferTokens). Default 0. */
  bufferTokens?: number
  /** Model max output; used to cap reservation in usable mode. */
  maxOutput?: number | null
}

/**
 * Dispatch gate by {@link ContextGateMode}.
 * - percent: buffer ignored; {@link exceedsThreshold}
 * - percent_minus_buffer: {@link exceedsThresholdWithBuffer}
 * - usable: used against usable width (window − buffer) at thresholdPercent
 *   (integer: used*100 >= usable*pct). With buffer=0 matches percent when
 *   usable === window.
 * - usable width 0 (buffer ≥ window) ⇒ always over budget.
 */
export function exceedsGate(
  used: number,
  contextWindow: number,
  thresholdPercent: number,
  opts?: ExceedsGateOptions,
): boolean {
  const mode: ContextGateMode = opts?.gateMode ?? 'percent'
  const buffer = Math.max(0, Math.floor(opts?.bufferTokens ?? 0) || 0)

  if (mode === 'percent_minus_buffer') {
    return exceedsThresholdWithBuffer(used, contextWindow, thresholdPercent, buffer)
  }

  if (mode === 'usable') {
    if (contextWindow <= 0) return false
    const usable = usableContextTokensFromBuffer(contextWindow, buffer, opts?.maxOutput)
    // buffer ≥ window ⇒ no usable headroom — always over budget (misconfig path).
    if (usable <= 0) return true
    const pct = clampThresholdPercent(thresholdPercent)
    return used * 100 >= usable * pct
  }

  // percent (default): buffer ignored
  return exceedsThreshold(used, contextWindow, thresholdPercent)
}

/** total − used, saturating at 0. */
export function freeTokens(total: number, used: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(used) || used <= 0) return Math.floor(total)
  return Math.max(0, Math.floor(total) - Math.floor(used))
}

/**
 * Usage percentage as number in [0, 100]. Returns 0 when total <= 0.
 * Floating point (not truncated) — for display; gates use integer helpers.
 */
export function usagePercentage(used: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(used) || used <= 0) return 0
  return Math.min(100, (used / total) * 100)
}
