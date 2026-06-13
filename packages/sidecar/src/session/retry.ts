/** Retry transient LLM-API failures with exponential backoff + jitter, honoring `retry-after`. */

export const MAX_RETRIES = 4
const BASE_MS = 1000
const MAX_WAIT_MS = 30_000

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529])
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'])

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } } | null
  return e?.status ?? e?.statusCode ?? e?.response?.status
}

/** Transient = retryable: rate limit (429), 5xx/overload, or a network reset/timeout. NOT retryable:
 *  any other 4xx (incl. 400 context-overflow → compaction's job) and auth (401/403). */
export function isRetryable(err: unknown): boolean {
  const status = statusOf(err)
  if (status !== undefined) return RETRYABLE_STATUS.has(status)
  const code = (err as { code?: string } | null)?.code
  return code !== undefined && RETRYABLE_CODES.has(code)
}

function headerGet(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined
  const rec = headers as Record<string, string | undefined>
  return rec[name] ?? rec[name.toLowerCase()]
}

/** `retry-after` as ms: integer/decimal seconds, or an HTTP date. undefined if absent/unparseable. */
export function parseRetryAfter(err: unknown): number | undefined {
  const raw = headerGet((err as { headers?: unknown } | null)?.headers, 'retry-after')
  if (!raw) return undefined
  const secs = Number(raw)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

export interface RetryOpts {
  maxRetries?: number
  shouldRetry?: (err: unknown) => boolean
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

/** Run `fn`, retrying transient failures with exponential backoff + jitter and `retry-after`.
 *  Never retries once the AbortSignal is aborted. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES
  const shouldRetry = opts.shouldRetry ?? isRetryable
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = opts.random ?? Math.random
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (opts.signal?.aborted) throw err
      if (attempt >= maxRetries || !shouldRetry(err)) throw err
      const backoff = BASE_MS * 2 ** attempt
      const wait = Math.min(MAX_WAIT_MS, Math.max(parseRetryAfter(err) ?? 0, backoff + backoff * 0.25 * random()))
      await sleep(wait)
      attempt++
    }
  }
}
