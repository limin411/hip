import type { PermissionMode } from '@hip/protocol'
import type { JsonValue, Source, Unavailable } from '../system-context.js'
import { renderCapabilityNarrative } from '../agent-runtime-profile.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface PermissionSourcePayload {
  readonly text: string
  readonly mode: PermissionMode
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface PermissionSourceInput {
  readonly permissionMode?: PermissionMode
  readonly surface?: 'chat' | 'code' | 'knowledge' | 'terminal'
  readonly sessionId?: string
  readonly cwd?: string
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

function renderPermissionText(
  mode: PermissionMode,
  surface?: 'chat' | 'code' | 'knowledge' | 'terminal',
  sessionId?: string,
  cwd?: string,
): string {
  return renderCapabilityNarrative({ permissionMode: mode, surface, sessionId, cwd })
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
      return { text: renderPermissionText('edit', 'code'), mode: 'edit' }
    }
    const mode = permissionMode(j.mode)
    return {
      text: stringField(j, 'text') || renderPermissionText(mode, 'code'),
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
      return {
        text: renderPermissionText(mode, input.surface, input.sessionId, input.cwd),
        mode,
      }
    },
    baseline: (payload) => payload.text,
  }
}
