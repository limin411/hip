import type { TurnUsage } from '@hip/protocol'

/** Best single-request context size from a usage report.
 *  Only input / explicit contextTokens count — never billing `totalTokens`.
 *  Some providers (MiniMax stream usage) report output-only totals with input=0;
 *  treating that total as context fill makes the composer meter stick at 0%. */
export function stepContextTokens(u: TurnUsage): number {
  if (u.contextTokens != null && u.contextTokens > 0) return u.contextTokens
  if ((u.inputTokens ?? 0) > 0) return u.inputTokens
  return 0
}

/** Best-effort shape of LangChain `usage_metadata` (and provider extras). */
export type LangChainUsageMetadata = {
  input_tokens?: number | null
  output_tokens?: number | null
  total_tokens?: number | null
  /** Anthropic / LangChain nested input details. */
  input_token_details?: {
    cache_read?: number | null
    cache_creation?: number | null
    cached_tokens?: number | null
    cache_write?: number | null
  } | null
  /** OpenAI-compat nested prompt details (when not normalized). */
  prompt_tokens_details?: {
    cached_tokens?: number | null
    cache_write_tokens?: number | null
    audio_tokens?: number | null
  } | null
  output_token_details?: {
    reasoning?: number | null
    reasoning_tokens?: number | null
  } | null
  /** Top-level Anthropic Messages style. */
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  reasoning_tokens?: number | null
  [key: string]: unknown
}

export type UsageCaptureMeta = {
  modelId?: string
  providerId?: string
}

/**
 * Build TurnUsage from LangChain `usage_metadata` (+ optional chars/4 estimate when
 * the provider omits prompt tokens). Returns undefined when nothing usable.
 *
 * Cache/reasoning mapped best-effort; missing cache fields are **omitted** (not incomplete).
 */
export function usageFromModelMetadata(
  u: LangChainUsageMetadata | null | undefined,
  estimatedContextTokens?: number,
  meta?: UsageCaptureMeta,
): TurnUsage | undefined {
  if (!u) return undefined
  const inputTokens = finiteOrZero(u.input_tokens)
  const outputTokens = finiteOrZero(u.output_tokens)
  const totalRaw = finiteOrZero(u.total_tokens)
  const totalTokens = totalRaw > 0 ? totalRaw : inputTokens + outputTokens
  // No token fields at all → skip (same as "no usage_metadata").
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return undefined

  let contextTokens = inputTokens > 0 ? inputTokens : 0
  if (contextTokens <= 0 && estimatedContextTokens != null && estimatedContextTokens > 0) {
    contextTokens = estimatedContextTokens
  }

  const cache = extractCacheTokens(u)
  const reasoningTokens = extractReasoningTokens(u)

  let nonCachedInputTokens: number | undefined
  if (cache.cacheReadTokens != null || cache.cacheWriteTokens != null) {
    const cr = cache.cacheReadTokens ?? 0
    const cw = cache.cacheWriteTokens ?? 0
    nonCachedInputTokens = Math.max(0, inputTokens - cr - cw)
  }

  const out: TurnUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(contextTokens > 0 ? { contextTokens } : {}),
    ...(cache.cacheReadTokens != null ? { cacheReadTokens: cache.cacheReadTokens } : {}),
    ...(cache.cacheWriteTokens != null ? { cacheWriteTokens: cache.cacheWriteTokens } : {}),
    ...(nonCachedInputTokens != null ? { nonCachedInputTokens } : {}),
    ...(reasoningTokens != null ? { reasoningTokens } : {}),
    ...(meta?.modelId ? { modelId: meta.modelId } : {}),
    ...(meta?.providerId ? { providerId: meta.providerId } : {}),
  }
  return out
}

function extractCacheTokens(u: LangChainUsageMetadata): {
  cacheReadTokens?: number
  cacheWriteTokens?: number
} {
  let cacheRead: number | undefined
  let cacheWrite: number | undefined

  const details = u.input_token_details
  if (details && typeof details === 'object') {
    const read = firstPositive(details.cache_read, details.cached_tokens)
    if (read != null) cacheRead = read
    const write = firstPositive(details.cache_creation, details.cache_write)
    if (write != null) cacheWrite = write
  }

  const promptDetails = u.prompt_tokens_details
  if (promptDetails && typeof promptDetails === 'object') {
    if (cacheRead == null) {
      const read = firstPositive(promptDetails.cached_tokens)
      if (read != null) cacheRead = read
    }
    if (cacheWrite == null) {
      const write = firstPositive(promptDetails.cache_write_tokens)
      if (write != null) cacheWrite = write
    }
  }

  if (cacheRead == null) {
    const top = firstPositive(u.cache_read_input_tokens)
    if (top != null) cacheRead = top
  }
  if (cacheWrite == null) {
    const top = firstPositive(u.cache_creation_input_tokens)
    if (top != null) cacheWrite = top
  }

  return {
    ...(cacheRead != null ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite != null ? { cacheWriteTokens: cacheWrite } : {}),
  }
}

function extractReasoningTokens(u: LangChainUsageMetadata): number | undefined {
  const top = firstPositive(u.reasoning_tokens)
  if (top != null) return top
  const details = u.output_token_details
  if (details && typeof details === 'object') {
    return firstPositive(details.reasoning, details.reasoning_tokens)
  }
  return undefined
}

function firstPositive(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    const n = finiteOrZero(v)
    if (n > 0) return n
  }
  return undefined
}

function finiteOrZero(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function sumOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined
  return (a ?? 0) + (b ?? 0)
}

function lastNonEmpty(prev: string | undefined, next: string | undefined): string | undefined {
  if (next != null && next !== '') return next
  if (prev != null && prev !== '') return prev
  return undefined
}

/** Fold optional fields that sum (cache/reasoning) + OR incomplete + last model ids.
 *  nonCached is **not** summed — recompute via reconcileNonCached after billing totals. */
function foldOptionalTokenSums(acc: TurnUsage | undefined, next: TurnUsage): Partial<TurnUsage> {
  const cacheReadTokens = sumOpt(acc?.cacheReadTokens, next.cacheReadTokens)
  const cacheWriteTokens = sumOpt(acc?.cacheWriteTokens, next.cacheWriteTokens)
  const reasoningTokens = sumOpt(acc?.reasoningTokens, next.reasoningTokens)
  const incomplete = acc?.incomplete === true || next.incomplete === true ? true : undefined
  const modelId = lastNonEmpty(acc?.modelId, next.modelId)
  const providerId = lastNonEmpty(acc?.providerId, next.providerId)
  return {
    ...(cacheReadTokens != null ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
    ...(reasoningTokens != null ? { reasoningTokens } : {}),
    ...(incomplete ? { incomplete: true } : {}),
    ...(modelId ? { modelId } : {}),
    ...(providerId ? { providerId } : {}),
  }
}

/**
 * Keep nonCached honest after folds: when any cache field is present, recompute
 * nonCached = max(0, input − cacheRead − cacheWrite). When no cache breakdown,
 * omit nonCached (do not leave a partial sum from mixed steps).
 */
function reconcileNonCached(u: TurnUsage): TurnUsage {
  const hasCache = u.cacheReadTokens != null || u.cacheWriteTokens != null
  if (hasCache) {
    const cr = u.cacheReadTokens ?? 0
    const cw = u.cacheWriteTokens ?? 0
    return { ...u, nonCachedInputTokens: Math.max(0, u.inputTokens - cr - cw) }
  }
  if (u.nonCachedInputTokens == null) return u
  const { nonCachedInputTokens: _drop, ...rest } = u
  return rest
}

/** Fold one step's usage into an accumulator (immutable; undefined acc → seed).
 *  Billing + optional token fields sum; contextTokens tracks the **last** step's context size.
 *  incomplete OR; modelId/providerId last non-empty. */
export function addUsage(acc: TurnUsage | undefined, next: TurnUsage): TurnUsage {
  const nextCtx = stepContextTokens(next)
  const opts = foldOptionalTokenSums(acc, next)
  if (!acc) {
    return reconcileNonCached({
      inputTokens: next.inputTokens,
      outputTokens: next.outputTokens,
      totalTokens: next.totalTokens,
      ...(nextCtx > 0 ? { contextTokens: nextCtx } : {}),
      ...opts,
    })
  }
  return reconcileNonCached({
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
    ...(nextCtx > 0
      ? { contextTokens: nextCtx }
      : acc.contextTokens != null && acc.contextTokens > 0
        ? { contextTokens: acc.contextTokens }
        : {}),
    ...opts,
  })
}

/** Sum per-agent usages into the turn total. Returns undefined when nothing was reported.
 *  Billing + optional token fields sum; contextTokens is the **max** across agents.
 *  incomplete OR; modelId/providerId last non-empty. */
export function sumUsage(parts: ReadonlyArray<TurnUsage | undefined>): TurnUsage | undefined {
  let out: TurnUsage | undefined
  for (const p of parts) {
    if (!p) continue
    if (!out) {
      const ctx = stepContextTokens(p)
      out = reconcileNonCached({
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        totalTokens: p.totalTokens,
        ...(ctx > 0 ? { contextTokens: ctx } : {}),
        ...foldOptionalTokenSums(undefined, p),
      })
      continue
    }
    const ctx = stepContextTokens(p)
    const prevCtx = out.contextTokens ?? 0
    out = reconcileNonCached({
      inputTokens: out.inputTokens + p.inputTokens,
      outputTokens: out.outputTokens + p.outputTokens,
      totalTokens: out.totalTokens + p.totalTokens,
      ...(Math.max(prevCtx, ctx) > 0 ? { contextTokens: Math.max(prevCtx, ctx) } : {}),
      ...foldOptionalTokenSums(out, p),
    })
  }
  return out
}

/** Serialize TurnUsage for agent_runs.usage_json (or event payloads). */
export function serializeTurnUsage(u: TurnUsage): string {
  return JSON.stringify(u)
}

/** Parse usage_json TEXT → TurnUsage. Invalid / incomplete shape → undefined. */
export function parseTurnUsageJson(raw: string | null | undefined): TurnUsage | undefined {
  if (raw == null || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  return parseTurnUsageObject(parsed)
}

/** Coerce an unknown object into TurnUsage when core token fields are valid.
 *  Optional token counts: non-negative ints. contextTokens: positive only.
 *  Shared by store usage_json load and event parseUsage projection. */
export function parseTurnUsageObject(raw: unknown): TurnUsage | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  const inputTokens = u['inputTokens']
  const outputTokens = u['outputTokens']
  const totalTokens = u['totalTokens']
  if (
    typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) ||
    typeof outputTokens !== 'number' || !Number.isFinite(outputTokens) ||
    typeof totalTokens !== 'number' || !Number.isFinite(totalTokens)
  ) {
    return undefined
  }
  const out: TurnUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
  }
  const ctx = optPositiveInt(u['contextTokens'])
  if (ctx != null) out.contextTokens = ctx

  const cacheRead = optNonNegInt(u['cacheReadTokens'])
  if (cacheRead != null) out.cacheReadTokens = cacheRead
  const cacheWrite = optNonNegInt(u['cacheWriteTokens'])
  if (cacheWrite != null) out.cacheWriteTokens = cacheWrite
  const nonCached = optNonNegInt(u['nonCachedInputTokens'])
  if (nonCached != null) out.nonCachedInputTokens = nonCached
  const reasoning = optNonNegInt(u['reasoningTokens'])
  if (reasoning != null) out.reasoningTokens = reasoning

  if (typeof u['modelId'] === 'string' && u['modelId']) out.modelId = u['modelId']
  if (typeof u['providerId'] === 'string' && u['providerId']) out.providerId = u['providerId']
  if (u['incomplete'] === true) out.incomplete = true

  return out
}

function optPositiveInt(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

function optNonNegInt(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}
