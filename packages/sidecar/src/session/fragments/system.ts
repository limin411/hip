import type { PermissionMode, SkillMeta } from '@hip/protocol'
import type { JsonValue, Source, Unavailable } from '../system-context.js'
import { buildSystemPrompt } from '../system-prompt.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface SystemSourcePayload {
  readonly text: string
  readonly systemPrompt: string
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface SystemSourceInput {
  readonly cwd?: string
  readonly userInstructions?: string
  readonly skills?: SkillMeta[]
  readonly permissionMode?: PermissionMode
  readonly mcpCatalog?: string
  readonly surface?: 'chat' | 'code'
}

// ── Codec ─────────────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

const codec = {
  encode(a: SystemSourcePayload): JsonValue {
    return {
      text: a.text,
      systemPrompt: a.systemPrompt,
    }
  },
  decode(j: JsonValue): SystemSourcePayload {
    if (!isObject(j)) {
      return { text: '', systemPrompt: '' }
    }
    return {
      text: stringField(j, 'text'),
      systemPrompt: stringField(j, 'systemPrompt'),
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createSystemSource(input: SystemSourceInput): Source<SystemSourcePayload> {
  return {
    key: 'fragment:system',
    codec,
    load: async () => {
      if (input.cwd === undefined) {
        return { _tag: 'Unavailable', reason: 'cwd is not set' } as Unavailable
      }
      const systemPrompt = buildSystemPrompt({
        cwd: input.cwd,
        userInstructions: input.userInstructions,
        skills: input.skills,
        permissionMode: input.permissionMode,
        mcpCatalog: input.mcpCatalog,
        surface: input.surface,
      })
      return { text: systemPrompt, systemPrompt }
    },
    baseline: (payload) => payload.text,
  }
}
