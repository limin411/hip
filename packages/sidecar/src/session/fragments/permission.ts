import type { PermissionMode } from '@hip/protocol'
import type { JsonValue, Source, Unavailable } from '../system-context.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface PermissionSourcePayload {
  readonly text: string
  readonly mode: PermissionMode
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface PermissionSourceInput {
  readonly permissionMode?: PermissionMode
}

// ── Codec ─────────────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

function permissionMode(j: JsonValue): PermissionMode {
  if (j === 'chat' || j === 'edit' || j === 'full') return j
  return 'edit'
}

function renderPermissionText(mode: PermissionMode): string {
  return `Current permission mode: ${mode}.`
}

const codec = {
  encode(a: PermissionSourcePayload): JsonValue {
    return {
      text: a.text,
      mode: a.mode,
    }
  },
  decode(j: JsonValue): PermissionSourcePayload {
    if (!isObject(j)) {
      return { text: renderPermissionText('edit'), mode: 'edit' }
    }
    const mode = permissionMode(j.mode)
    return {
      text: stringField(j, 'text') || renderPermissionText(mode),
      mode,
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createPermissionSource(
  input: PermissionSourceInput,
): Source<PermissionSourcePayload> {
  return {
    key: 'fragment:permission',
    codec,
    load: async () => {
      if (input.permissionMode === undefined) {
        return { _tag: 'Unavailable', reason: 'permission mode is not set' } as Unavailable
      }
      const mode = input.permissionMode
      return { text: renderPermissionText(mode), mode }
    },
    baseline: (payload) => payload.text,
  }
}
