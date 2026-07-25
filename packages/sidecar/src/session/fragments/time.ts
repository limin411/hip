import type { JsonValue, Source } from '../system-context.js'
import {
  currentTimeIsoMinute,
  formatCurrentTimeText,
} from '../current-time.js'

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

function textFromIso(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return formatCurrentTimeText()
  }
  return formatCurrentTimeText(parsed)
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
      const fallback = currentTimeIsoMinute()
      return { text: textFromIso(fallback), now: fallback }
    }
    const now = stringField(j, 'now')
    return {
      text: now ? textFromIso(now) : stringField(j, 'text'),
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
      const date = input.now ?? new Date()
      const now = currentTimeIsoMinute(date)
      return { text: formatCurrentTimeText(date), now }
    },
    baseline: (payload) => payload.text,
  }
}
