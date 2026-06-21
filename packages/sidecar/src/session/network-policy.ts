import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { NetworkPolicyConfig } from '@hip/protocol'

// NetworkPolicy — domain allowlist/denylist + per-session rate limiting +
// response-size cap. Layered ON TOP OF the existing SSRF check in
// `validateFetchUrl` (tools.ts:58-108). The SSRF check runs first; this module
// is the second gate and does NOT re-implement private-IP detection, https-only
// enforcement, or DNS resolution.

/** Load network policy config from `~/.hip/config/network.json`, if present. */
export function loadNetworkPolicyConfig(): NetworkPolicyConfig | undefined {
  const path = join(homedir(), '.hip', 'config', 'network.json')
  if (!existsSync(path)) return undefined
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as NetworkPolicyConfig
  } catch (err) {
    console.warn('[network-policy] failed to load config:', err instanceof Error ? err.message : String(err))
    return undefined
  }
}

// ── Public types ─────────────────────────────────────────────────────────────

/** Outcome of a policy check. `reason` is present iff `allowed === false`. */
export interface NetworkCheckResult {
  allowed: boolean
  reason?: string
}

export type { NetworkPolicyConfig } from '@hip/protocol'

/** Constructor options. The `now` injector exists for deterministic tests. */
export interface NetworkPolicyOpts {
  /** Wall-clock source for rate-limit windowing. Default: Date.now. */
  now?: () => number
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_REQUESTS_PER_MINUTE = 10
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MB
const WINDOW_MS = 60_000

// ── Per-session rate-limit state ─────────────────────────────────────────────

interface RateBucket {
  /** Number of requests seen in the current window. */
  count: number
  /** Epoch-ms timestamp marking the start of the current window. */
  windowStart: number
}

// ── Domain-pattern matching ──────────────────────────────────────────────────

/**
 * Match a hostname against a domain pattern. Supports two shapes:
 *   - exact:    `api.openai.com` matches only `api.openai.com`
 *   - wildcard: `*.github.com`   matches any `<sub>.github.com` (the `*`
 *               must be the leftmost label and consumes one-or-more labels).
 *
 * The wildcard is anchored: `*.github.com` does NOT match the bare apex
 * `github.com`, and a suffix-collision attack like `api.github.com.evil.com`
 * fails because the pattern requires `.github.com` to be the terminal suffix.
 */
function matchesDomain(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // keep the leading dot
    // hostname must have at least one label before the suffix
    return hostname.endsWith(suffix) && hostname.length > suffix.length
  }
  return hostname === pattern
}

function matchesAny(hostname: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((p) => matchesDomain(hostname, p))
}

// ── NetworkPolicy ────────────────────────────────────────────────────────────

/**
 * Layered network policy for the `web_fetch` / `web_search` tools.
 *
 * Lifecycle:
 *   1. Existing `validateFetchUrl` runs first (https-only + SSRF / private-IP).
 *   2. `NetworkPolicy.checkUrl()` runs second (domain allowlist/denylist).
 *   3. `NetworkPolicy.checkRateLimit()` runs third (per-session budget).
 *   4. After the response arrives, the caller is responsible for enforcing
 *      `getResponseSizeCap()` (e.g. via a capped read stream).
 *
 * Defaults with no config: allow all https (the SSRF layer is the only gate).
 */
export class NetworkPolicy {
  private allowlist: string[]
  private denylist: string[]
  private maxRequestsPerMinute: number
  private maxResponseBytes: number
  private readonly now: () => number
  private readonly buckets: Map<string, RateBucket> = new Map()
  private _hasLoadedCustomConfig = false

  constructor(config?: NetworkPolicyConfig, opts?: NetworkPolicyOpts) {
    this.allowlist = config?.allowlist ? [...config.allowlist] : []
    this.denylist = config?.denylist ? [...config.denylist] : []
    this.maxRequestsPerMinute = config?.maxRequestsPerMinute ?? DEFAULT_MAX_REQUESTS_PER_MINUTE
    this.maxResponseBytes = config?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
    this.now = opts?.now ?? Date.now
  }

  /**
   * Synchronous domain-policy check. Does NOT touch the network — that is the
   * SSRF layer's job. Returns `{allowed: true}` for any URL when no allowlist
   * and no denylist are configured.
   */
  checkUrl(rawUrl: string): NetworkCheckResult {
    let hostname: string
    try {
      hostname = new URL(rawUrl).hostname.toLowerCase()
    } catch {
      return { allowed: false, reason: 'URL is invalid' }
    }

    // 1. Denylist wins.
    if (matchesAny(hostname, this.denylist)) {
      return { allowed: false, reason: 'Domain is in denylist' }
    }

    // 2. Empty allowlist → allow everything not denied.
    if (this.allowlist.length === 0) {
      return { allowed: true }
    }

    // 3. Non-empty allowlist → must match.
    if (matchesAny(hostname, this.allowlist)) {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Domain is not in allowlist' }
  }

  /**
   * Per-session rate-limit check. Increments the session's counter; returns
   * `{allowed: false}` when the counter exceeds `maxRequestsPerMinute` within
   * the current 60-second window. The window resets lazily on the first call
   * that lands past `windowStart + WINDOW_MS`.
   */
  checkRateLimit(sessionId: string): NetworkCheckResult {
    const t = this.now()
    const existing = this.buckets.get(sessionId)
    let bucket: RateBucket
    if (!existing) {
      bucket = { count: 0, windowStart: t }
    } else if (t - existing.windowStart >= WINDOW_MS) {
      // window elapsed → start a fresh bucket
      bucket = { count: 0, windowStart: t }
    } else {
      bucket = existing
    }

    bucket.count += 1
    this.buckets.set(sessionId, bucket)

    if (bucket.count > this.maxRequestsPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${bucket.count} requests in the current ` +
          `${WINDOW_MS / 1000}s window (cap: ${this.maxRequestsPerMinute})`,
      }
    }
    return { allowed: true }
  }

  /** Response-body size cap, in bytes. */
  getResponseSizeCap(): number {
    return this.maxResponseBytes
  }

  /** Merge a partial config update into the active config. */
  updateConfig(config: Partial<NetworkPolicyConfig>): void {
    if (config.allowlist !== undefined) this.allowlist = [...config.allowlist]
    if (config.denylist !== undefined) this.denylist = [...config.denylist]
    if (config.maxRequestsPerMinute !== undefined) {
      this.maxRequestsPerMinute = config.maxRequestsPerMinute
    }
    if (config.maxResponseBytes !== undefined) {
      this.maxResponseBytes = config.maxResponseBytes
    }
    this._hasLoadedCustomConfig = true
  }

  /** Whether a custom config has ever been applied via `updateConfig`. */
  hasLoadedCustomConfig(): boolean {
    return this._hasLoadedCustomConfig
  }

  /**
   * Restore all network-policy fields to their hard-coded defaults.
   * Rate-limit buckets are intentionally preserved so in-flight budget
   * tracking is not lost on a config rollback.
   */
  reset(): void {
    this.allowlist = []
    this.denylist = []
    this.maxRequestsPerMinute = DEFAULT_MAX_REQUESTS_PER_MINUTE
    this.maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
    this._hasLoadedCustomConfig = false
  }
}
