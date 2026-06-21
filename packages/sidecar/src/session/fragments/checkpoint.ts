import type { JsonValue, Source, Unavailable } from '../system-context.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface CheckpointSourcePayload {
  readonly text: string
  readonly checkpointId: string | null
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface CheckpointSourceInput {
  /** `undefined` means the source has not been initialized; `null` means no checkpoint. */
  readonly checkpointId?: string | null
}

// ── Codec ─────────────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

function optionalString(j: JsonValue): string | null {
  if (j === null) return null
  return typeof j === 'string' ? j : null
}

function renderCheckpointText(checkpointId: string | null): string {
  if (checkpointId === null) {
    return 'No checkpoint has been captured for this session.'
  }
  return `Current git checkpoint: ${checkpointId}.`
}

const codec = {
  encode(a: CheckpointSourcePayload): JsonValue {
    return {
      text: a.text,
      checkpointId: a.checkpointId,
    }
  },
  decode(j: JsonValue): CheckpointSourcePayload {
    if (!isObject(j)) {
      return { text: '', checkpointId: null }
    }
    const checkpointId = optionalString(j.checkpointId)
    return {
      text: stringField(j, 'text') || renderCheckpointText(checkpointId),
      checkpointId,
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createCheckpointSource(
  input: CheckpointSourceInput,
): Source<CheckpointSourcePayload> {
  return {
    key: 'fragment:checkpoint',
    codec,
    load: async () => {
      if (input.checkpointId === undefined) {
        return { _tag: 'Unavailable', reason: 'checkpoint is not initialized' } as Unavailable
      }
      const checkpointId = input.checkpointId
      return { text: renderCheckpointText(checkpointId), checkpointId }
    },
    baseline: (payload) => payload.text,
  }
}
