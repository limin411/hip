/**
 * Provider key usability probe (product A: provider-key level, not per-model entitlement).
 * Network probes use raw fetch with timeouts; never LangChain / session turns.
 */
import { createHash } from 'node:crypto'
import type { KeyProbeCode } from '@hip/protocol'
import { resolveApiKey } from './auth-file.js'
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  cheapModelFor,
  isOpenAICompatible,
} from './providers.js'
import { readHipConfig } from './hip-config.js'
import { safeErrorMessage } from '../session/error.js'

export type ProbePurpose = 'chat' | 'embedding' | 'rerank'

export interface ProviderProbeRequest {
  purpose: ProbePurpose
  providerID: string
  baseURL?: string
  modelID?: string
  /** Unsaved key from the form; preferred over resolveApiKey when non-empty. */
  draftApiKey?: string
}

export interface ProviderProbeResult {
  ok: boolean
  code: KeyProbeCode
  message: string
  latencyMs?: number
  checkedAt: number
  cached?: boolean
}

const SUCCESS_TTL_MS = 10 * 60 * 1000
const AUTH_FAIL_TTL_MS = 60 * 1000
const TRANSIENT_FAIL_TTL_MS = 30 * 1000
const RATE_LIMIT_MS = 15 * 1000
const MAX_LIVE = 6
const NETWORK_TIMEOUT_MS = 8_000

type CacheEntry = {
  result: ProviderProbeResult
  expiresAt: number
  lastLiveAt: number
}

const cache = new Map<string, CacheEntry>()
let liveInFlight = 0

/** Test-only: clear probe cache and concurrency counters. */
export function resetProviderProbeStateForTests(): void {
  cache.clear()
  liveInFlight = 0
}

function joinUrl(baseURL: string, segment: string): string {
  const base = baseURL.replace(/\/+$/, '')
  const path = segment.replace(/^\/+/, '')
  return `${base}/${path}`
}

function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12)
}

function cacheKey(
  purpose: ProbePurpose,
  providerID: string,
  baseURL: string,
  modelID: string,
  keyFp: string,
): string {
  return createHash('sha256')
    .update([purpose, providerID, baseURL, modelID, keyFp].join('\0'))
    .digest('hex')
    .slice(0, 24)
}

function fail(
  code: KeyProbeCode,
  message: string,
  extra?: Partial<ProviderProbeResult>,
): ProviderProbeResult {
  return { ok: false, code, message, checkedAt: Date.now(), ...extra }
}

function okResult(latencyMs: number, message = 'Key works'): ProviderProbeResult {
  return { ok: true, code: 'OK', message, latencyMs, checkedAt: Date.now() }
}

function isChatProviderDisabled(providerID: string): boolean {
  const entry = readHipConfig().providers?.find((p) => p.id === providerID)
  return entry?.enabled === false
}

/** Classify status for completion / messages / embeddings (not /models list). */
export function classifyCompletionStatus(status: number): KeyProbeCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 404) return 'MODEL_NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 400) return 'PROVIDER_ERROR'
  return 'OK'
}

/** Final status after /models fallback path is exhausted (no MODEL_NOT_FOUND for list 404). */
export function classifyModelsListFinalStatus(status: number): KeyProbeCode {
  if (status === 401 || status === 403) return 'AUTH_FAILED'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 400) return 'PROVIDER_ERROR'
  return 'OK'
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function networkFail(err: unknown): ProviderProbeResult {
  const msg = safeErrorMessage(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return fail('NETWORK', 'Request timed out')
  }
  return fail('NETWORK', msg || 'Network error')
}

function resolveChatModelId(providerID: string, modelID?: string): string | undefined {
  const trimmed = modelID?.trim()
  if (trimmed) return trimmed
  const cheap = cheapModelFor(providerID, '')
  return cheap || undefined
}

async function probeOpenAICompatibleChat(
  baseURL: string,
  key: string,
  providerID: string,
  modelID: string | undefined,
): Promise<ProviderProbeResult> {
  const started = Date.now()
  const modelsUrl = joinUrl(baseURL, 'models')
  let modelsRes: Response
  try {
    modelsRes = await fetchWithTimeout(modelsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch (err) {
    return networkFail(err)
  }

  if (modelsRes.status === 401 || modelsRes.status === 403) {
    return fail('AUTH_FAILED', `Authentication failed (${modelsRes.status})`, {
      latencyMs: Date.now() - started,
    })
  }

  if (modelsRes.ok) {
    return okResult(Date.now() - started)
  }

  // Only 404 on /models triggers completion fallback (product A: key-level).
  if (modelsRes.status !== 404) {
    const code = classifyModelsListFinalStatus(modelsRes.status)
    return fail(code, `Models list failed (${modelsRes.status})`, {
      latencyMs: Date.now() - started,
    })
  }

  const resolvedModel = resolveChatModelId(providerID, modelID)
  if (!resolvedModel) {
    return fail('MISSING_MODEL', 'No model id available for completion fallback', {
      latencyMs: Date.now() - started,
    })
  }

  const body = {
    model: resolvedModel,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  }
  let completionRes: Response
  try {
    completionRes = await fetchWithTimeout(joinUrl(baseURL, 'chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return networkFail(err)
  }

  const code = classifyCompletionStatus(completionRes.status)
  if (code === 'OK' && completionRes.ok) {
    return okResult(Date.now() - started)
  }
  return fail(code === 'OK' ? 'PROVIDER_ERROR' : code, `Completion probe failed (${completionRes.status})`, {
    latencyMs: Date.now() - started,
  })
}

async function probeAnthropicChat(
  baseURL: string | undefined,
  key: string,
  providerID: string,
  modelID: string | undefined,
): Promise<ProviderProbeResult> {
  const started = Date.now()
  const base = (baseURL?.trim() || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const resolvedModel = resolveChatModelId(providerID, modelID)
  if (!resolvedModel) {
    return fail('MISSING_MODEL', 'No model id available for Anthropic probe')
  }

  let res: Response
  try {
    res = await fetchWithTimeout(joinUrl(base, 'messages'), {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
  } catch (err) {
    return networkFail(err)
  }

  const code = classifyCompletionStatus(res.status)
  if (code === 'OK' && res.ok) {
    return okResult(Date.now() - started)
  }
  return fail(code === 'OK' ? 'PROVIDER_ERROR' : code, `Anthropic probe failed (${res.status})`, {
    latencyMs: Date.now() - started,
  })
}

async function probeEmbedding(
  baseURL: string,
  key: string,
  modelID: string,
): Promise<ProviderProbeResult> {
  const started = Date.now()
  let res: Response
  try {
    res = await fetchWithTimeout(joinUrl(baseURL, 'embeddings'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: modelID, input: ['hip-key-probe'] }),
    })
  } catch (err) {
    return networkFail(err)
  }

  if (!res.ok) {
    const code = classifyCompletionStatus(res.status)
    return fail(code === 'OK' ? 'PROVIDER_ERROR' : code, `Embeddings probe failed (${res.status})`, {
      latencyMs: Date.now() - started,
    })
  }

  try {
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
    const emb = json.data?.[0]?.embedding
    if (!Array.isArray(emb) || emb.length === 0) {
      return fail('INVALID_RESPONSE', 'Embeddings response missing vector', {
        latencyMs: Date.now() - started,
      })
    }
    return okResult(Date.now() - started)
  } catch (err) {
    return fail('INVALID_RESPONSE', safeErrorMessage(err) || 'Invalid embeddings JSON', {
      latencyMs: Date.now() - started,
    })
  }
}

function ttlFor(result: ProviderProbeResult): number {
  if (result.ok) return SUCCESS_TTL_MS
  if (result.code === 'AUTH_FAILED') return AUTH_FAIL_TTL_MS
  return TRANSIENT_FAIL_TTL_MS
}

/**
 * Run a key usability probe with local prechecks, cache, rate limits, and network.
 * Always returns a result object (never throws for classification paths).
 */
export async function runProviderProbe(req: ProviderProbeRequest): Promise<ProviderProbeResult> {
  // 1. Feature flag
  if (process.env.HIP_KEY_PROBE === '0') {
    return fail('PROBE_DISABLED', 'Key probe disabled (HIP_KEY_PROBE=0)')
  }

  const purpose = req.purpose
  const providerID = req.providerID?.trim() ?? ''
  if (!providerID) {
    return fail('INTERNAL', 'providerID is required')
  }

  // 2. Field / purpose prechecks
  if (purpose === 'rerank') {
    // Still require local fields for consistent UX; then honest unsupported.
    const base = req.baseURL?.trim() ?? ''
    const model = req.modelID?.trim() ?? ''
    if (!base) return fail('MISSING_BASE_URL', 'Base URL is required')
    if (!model) return fail('MISSING_MODEL', 'Model id is required')
    const draft = req.draftApiKey?.trim()
    const key = draft || resolveApiKey(providerID)
    if (!key) return fail('MISSING_KEY', 'API key is missing')
    return fail('PROBE_UNSUPPORTED', 'Rerank key probe is not supported yet')
  }

  if (purpose === 'chat') {
    if (isChatProviderDisabled(providerID)) {
      return fail('PROVIDER_DISABLED', 'Provider is disabled')
    }
    if (!isOpenAICompatible(providerID) && providerID !== 'anthropic') {
      return fail('INCOMPATIBLE_PROVIDER', `Provider ${providerID} is not probeable`)
    }
  }

  const baseURL = req.baseURL?.trim() ?? ''
  if (purpose === 'embedding') {
    if (!baseURL) return fail('MISSING_BASE_URL', 'Base URL is required')
    if (!req.modelID?.trim()) return fail('MISSING_MODEL', 'Model id is required')
  }
  if (purpose === 'chat' && providerID !== 'anthropic' && !baseURL) {
    return fail('MISSING_BASE_URL', 'Base URL is required')
  }

  // 3. Resolve key
  const draft = req.draftApiKey?.trim()
  const key = draft || resolveApiKey(providerID)
  if (!key) return fail('MISSING_KEY', 'API key is missing')

  const modelForCache = req.modelID?.trim() ?? ''
  const baseForCache =
    purpose === 'chat' && providerID === 'anthropic'
      ? baseURL || ANTHROPIC_DEFAULT_BASE_URL
      : baseURL
  const ck = cacheKey(purpose, providerID, baseForCache, modelForCache, keyFingerprint(key))

  // 4. Cache lookup (before busy / rate)
  const now = Date.now()
  const hit = cache.get(ck)
  if (hit && hit.expiresAt > now) {
    return { ...hit.result, cached: true, checkedAt: hit.result.checkedAt }
  }

  // 5. Live concurrency
  if (liveInFlight >= MAX_LIVE) {
    return fail('PROBE_BUSY', 'Too many concurrent key probes')
  }

  // 6. Per-key rate limit (only when no usable cache)
  if (hit && now - hit.lastLiveAt < RATE_LIMIT_MS) {
    return fail('PROBE_RATE_LIMITED', 'Key probe rate limited; try again shortly')
  }

  // 7–8. Network
  liveInFlight += 1
  try {
    let result: ProviderProbeResult
    if (purpose === 'embedding') {
      result = await probeEmbedding(baseURL, key, req.modelID!.trim())
    } else if (providerID === 'anthropic') {
      result = await probeAnthropicChat(baseURL || undefined, key, providerID, req.modelID)
    } else {
      result = await probeOpenAICompatibleChat(baseURL, key, providerID, req.modelID)
    }

    cache.set(ck, {
      result: { ...result, cached: undefined },
      expiresAt: Date.now() + ttlFor(result),
      lastLiveAt: Date.now(),
    })
    return result
  } catch (err) {
    const result = fail('INTERNAL', safeErrorMessage(err))
    cache.set(ck, {
      result,
      expiresAt: Date.now() + TRANSIENT_FAIL_TTL_MS,
      lastLiveAt: Date.now(),
    })
    return result
  } finally {
    liveInFlight -= 1
  }
}
