/**
 * Context-window threshold / fill helpers (pure integer arithmetic where gates matter).
 *
 * Gate modes (KD-3):
 * - percent (default): used*100 >= window*pct  — buffer ignored when 0 / unused
 * - percent_minus_buffer: used*100 >= window*pct - buffer*100  (NOT default)
 * - usable: used against (window - buffer) * pct/100  (OC-inspired)
 */
import { DEFAULT_OUTPUT_BUFFER_CAP } from './constants.js'

/** Context pressure gate mode for auto-compact. Default product path: percent. */
export type ContextGateMode = 'percent' | 'usable' | 'percent_minus_buffer'

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
  const pct = clampPercent(thresholdPercent)
  return used * 100 >= contextWindow * pct
}

/**
 * GB headroom form: used*100 >= window*pct - buffer*100
 * (equivalent to used >= window*pct/100 - buffer).
 * When bufferTokens is 0, matches {@link exceedsThreshold}.
 * False when window <= 0. Saturates when buffer exceeds the scaled threshold.
 */
export function exceedsThresholdWithBuffer(
  used: number,
  contextWindow: number,
  thresholdPercent: number,
  bufferTokens: number,
): boolean {
  if (contextWindow <= 0) return false
  const pct = clampPercent(thresholdPercent)
  const buffer = Math.max(0, Math.floor(bufferTokens) || 0)
  const boundary = contextWindow * pct - buffer * 100
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
    if (usable <= 0) return used >= 0 // empty usable → any non-negative used fires
    const pct = clampPercent(thresholdPercent)
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

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
