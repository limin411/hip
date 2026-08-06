import type { ProjectedUsage } from './message-types.js'

/**
 * Boundary parsers for SessionEvent payloads.
 *
 * The event table is the source of truth — its `data` column is JSON, parsed
 * back to `Record<string, unknown>` by EventStore.loadEvents. Crossing back
 * into the projection's typed domain happens here, exactly once per field
 * access, with a typed error on shape mismatch. Inside the projection, code
 * receives typed values and never re-validates.
 */

export class EventPayloadError extends Error {
  constructor(eventType: string, field: string, raw: unknown) {
    super(`[message-updater] ${eventType} event missing/invalid field '${field}': ${JSON.stringify(raw)}`)
    this.name = 'EventPayloadError'
  }
}

export function reqString(data: Record<string, unknown>, eventType: string, field: string): string {
  const raw = data[field]
  if (typeof raw !== 'string' || raw.length === 0) throw new EventPayloadError(eventType, field, raw)
  return raw
}

export function optString(data: Record<string, unknown>, field: string): string | null {
  const raw = data[field]
  return typeof raw === 'string' ? raw : null
}

export function optNumber(data: Record<string, unknown>, field: string): number | null {
  const raw = data[field]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

export function optStringArray(data: Record<string, unknown>, field: string): readonly string[] {
  const raw = data[field]
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

export function optObjectArray<T>(
  data: Record<string, unknown>,
  field: string,
  guard?: (x: Record<string, unknown>) => x is Record<string, unknown> & T,
): T[] | undefined {
  const raw = data[field]
  if (!Array.isArray(raw)) return undefined
  return raw.filter((x): x is Record<string, unknown> & T => {
    if (x == null || typeof x !== 'object') return false
    return guard ? guard(x as Record<string, unknown>) : true
  })
}

export function parseUsage(data: Record<string, unknown>): ProjectedUsage | null {
  const usage = data['usage']
  if (usage == null || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  const inputTokens = u['inputTokens']
  const outputTokens = u['outputTokens']
  const totalTokens = u['totalTokens']
  if (
    typeof inputTokens !== 'number' || !Number.isFinite(inputTokens) ||
    typeof outputTokens !== 'number' || !Number.isFinite(outputTokens) ||
    typeof totalTokens !== 'number' || !Number.isFinite(totalTokens)
  ) {
    return null
  }
  const contextTokens = optPositiveInt(u['contextTokens'])
  const cacheReadTokens = optNonNegInt(u['cacheReadTokens'])
  const cacheWriteTokens = optNonNegInt(u['cacheWriteTokens'])
  const nonCachedInputTokens = optNonNegInt(u['nonCachedInputTokens'])
  const reasoningTokens = optNonNegInt(u['reasoningTokens'])
  const modelId = typeof u['modelId'] === 'string' && u['modelId'] ? u['modelId'] : undefined
  const providerId = typeof u['providerId'] === 'string' && u['providerId'] ? u['providerId'] : undefined
  const incomplete = u['incomplete'] === true ? true : undefined
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(contextTokens != null ? { contextTokens } : {}),
    ...(cacheReadTokens != null ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
    ...(nonCachedInputTokens != null ? { nonCachedInputTokens } : {}),
    ...(reasoningTokens != null ? { reasoningTokens } : {}),
    ...(modelId ? { modelId } : {}),
    ...(providerId ? { providerId } : {}),
    ...(incomplete ? { incomplete } : {}),
  }
}

function optPositiveInt(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

function optNonNegInt(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}
