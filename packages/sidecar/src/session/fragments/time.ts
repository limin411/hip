import type { JsonValue, Source } from '../system-context.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface TimeSourcePayload {
  readonly text: string
  readonly now: string
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface TimeSourceInput {
  /** Optional fixed date for deterministic tests. Defaults to `new Date()`. */
  readonly now?: Date
}

// ── Codec ─────────────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

function formatTimeText(iso: string): string {
  const formatted = iso.replace('T', ' ').slice(0, 19)
  return `It is ${formatted} UTC.`
}

const codec = {
  encode(a: TimeSourcePayload): JsonValue {
    return {
      text: a.text,
      now: a.now,
    }
  },
  decode(j: JsonValue): TimeSourcePayload {
    if (!isObject(j)) {
      const fallback = new Date().toISOString()
      return { text: formatTimeText(fallback), now: fallback }
    }
    const now = stringField(j, 'now')
    return {
      text: now ? formatTimeText(now) : stringField(j, 'text'),
      now,
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createTimeSource(input: TimeSourceInput = {}): Source<TimeSourcePayload> {
  return {
    key: 'fragment:time',
    codec,
    load: async () => {
      const now = (input.now ?? new Date()).toISOString()
      return { text: formatTimeText(now), now }
    },
    baseline: (payload) => payload.text,
  }
}
