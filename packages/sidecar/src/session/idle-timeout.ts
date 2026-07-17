/**
 * Resolve the turn idle-timeout (ms). This is **idle** (no outbound activity),
 * not a wall-clock max turn duration — see IdleWatchdog.
 *
 * Priority (high → low):
 * 1. env `HIP_IDLE_TIMEOUT_MS`
 * 2. `hip.toml` agent_loop.idle_timeout_ms / agentLoop.idleTimeoutMs
 * 3. surface default: code → 180s, else → 60s
 *
 * Result is clamped to [MIN_IDLE_TIMEOUT_MS, MAX_IDLE_TIMEOUT_MS].
 */

export const DEFAULT_IDLE_TIMEOUT_MS = 60_000
/** More headroom for code-surface turns that stream large tool args. */
export const DEFAULT_CODE_IDLE_TIMEOUT_MS = 180_000
export const MIN_IDLE_TIMEOUT_MS = 5_000
export const MAX_IDLE_TIMEOUT_MS = 1_800_000 // 30 min

export interface ResolveIdleTimeoutOpts {
  /** Raw env value (e.g. process.env.HIP_IDLE_TIMEOUT_MS). */
  env?: string | undefined
  /** From HipConfig.agentLoop.idleTimeoutMs. */
  configMs?: number | undefined
  /** Session surface; code gets a higher default when config/env unset. */
  surface?: 'chat' | 'code' | string | undefined
}

function clampIdleMs(n: number): number {
  return Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(MIN_IDLE_TIMEOUT_MS, Math.floor(n)))
}

function parsePositiveMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim())
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

/** Resolve idle timeout ms from env → config → surface default, then clamp. */
export function resolveIdleTimeoutMs(opts: ResolveIdleTimeoutOpts = {}): number {
  const fromEnv = parsePositiveMs(opts.env)
  if (fromEnv !== undefined) return clampIdleMs(fromEnv)

  const fromConfig = parsePositiveMs(opts.configMs)
  if (fromConfig !== undefined) return clampIdleMs(fromConfig)

  if (opts.surface === 'code') return DEFAULT_CODE_IDLE_TIMEOUT_MS
  return DEFAULT_IDLE_TIMEOUT_MS
}
