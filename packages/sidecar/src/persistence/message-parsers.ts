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
  return { inputTokens, outputTokens, totalTokens }
}
