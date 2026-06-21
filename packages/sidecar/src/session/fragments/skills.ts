import type { SkillMeta, SkillScope } from '@hip/protocol'
import type { JsonValue, Source, Unavailable } from '../system-context.js'
import { skillsBlock } from '../system-prompt.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface SkillsSourcePayload {
  readonly text: string
  readonly skills: SkillMeta[]
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface SkillsSourceInput {
  readonly skills?: SkillMeta[]
  readonly cwd?: string
}

// ── Codec helpers ─────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

function optionalString(j: { readonly [key: string]: JsonValue }, key: string): string | undefined {
  const value = j[key]
  return typeof value === 'string' ? value : undefined
}

function optionalBoolean(j: { readonly [key: string]: JsonValue }, key: string): boolean | undefined {
  const value = j[key]
  return typeof value === 'boolean' ? value : undefined
}

function optionalStringArray(j: { readonly [key: string]: JsonValue }, key: string): string[] | undefined {
  const value = j[key]
  if (!Array.isArray(value)) return undefined
  const filtered = value.filter((item): item is string => typeof item === 'string')
  return filtered.length > 0 ? filtered : undefined
}

function optionalScope(j: { readonly [key: string]: JsonValue }, key: string): SkillScope | undefined {
  const value = j[key]
  if (value === 'global' || value === 'project' || value === 'plugin') return value
  return undefined
}

function optionalContext(j: { readonly [key: string]: JsonValue }, key: string): 'inline' | 'fork' | undefined {
  const value = j[key]
  if (value === 'inline' || value === 'fork') return value
  return undefined
}

function optionalEffort(
  j: { readonly [key: string]: JsonValue },
  key: string,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  const value = j[key]
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value
  }
  return undefined
}

function skillMetaToJson(skill: SkillMeta): JsonValue {
  const obj: { [key: string]: JsonValue } = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    dir: skill.dir,
    hasScripts: skill.hasScripts,
  }
  if (skill.scope !== undefined) obj.scope = skill.scope
  if (skill.pluginId !== undefined) obj.pluginId = skill.pluginId
  if (skill.autoInvoke !== undefined) obj.autoInvoke = skill.autoInvoke
  if (skill.userInvocable !== undefined) obj.userInvocable = skill.userInvocable
  if (skill.allowedTools !== undefined) obj.allowedTools = skill.allowedTools
  if (skill.disallowedTools !== undefined) obj.disallowedTools = skill.disallowedTools
  if (skill.context !== undefined) obj.context = skill.context
  if (skill.paths !== undefined) obj.paths = skill.paths
  if (skill.model !== undefined) obj.model = skill.model
  if (skill.effort !== undefined) obj.effort = skill.effort
  return obj
}

function toSkillMeta(j: JsonValue): SkillMeta | undefined {
  if (!isObject(j)) return undefined
  if (
    typeof j.id !== 'string' ||
    typeof j.name !== 'string' ||
    typeof j.description !== 'string' ||
    typeof j.dir !== 'string' ||
    typeof j.hasScripts !== 'boolean'
  ) {
    return undefined
  }
  const skill: SkillMeta = {
    id: j.id,
    name: j.name,
    description: j.description,
    dir: j.dir,
    hasScripts: j.hasScripts,
  }
  const scope = optionalScope(j, 'scope')
  if (scope !== undefined) skill.scope = scope
  const pluginId = optionalString(j, 'pluginId')
  if (pluginId !== undefined) skill.pluginId = pluginId
  const autoInvoke = optionalBoolean(j, 'autoInvoke')
  if (autoInvoke !== undefined) skill.autoInvoke = autoInvoke
  const userInvocable = optionalBoolean(j, 'userInvocable')
  if (userInvocable !== undefined) skill.userInvocable = userInvocable
  const allowedTools = optionalStringArray(j, 'allowedTools')
  if (allowedTools !== undefined) skill.allowedTools = allowedTools
  const disallowedTools = optionalStringArray(j, 'disallowedTools')
  if (disallowedTools !== undefined) skill.disallowedTools = disallowedTools
  const context = optionalContext(j, 'context')
  if (context !== undefined) skill.context = context
  const paths = optionalStringArray(j, 'paths')
  if (paths !== undefined) skill.paths = paths
  const model = optionalString(j, 'model')
  if (model !== undefined) skill.model = model
  const effort = optionalEffort(j, 'effort')
  if (effort !== undefined) skill.effort = effort
  return skill
}

const codec = {
  encode(a: SkillsSourcePayload): JsonValue {
    return {
      text: a.text,
      skills: a.skills.map(skillMetaToJson),
    }
  },
  decode(j: JsonValue): SkillsSourcePayload {
    if (!isObject(j)) {
      return { text: '', skills: [] }
    }
    const rawSkills = Array.isArray(j.skills) ? j.skills : []
    return {
      text: stringField(j, 'text'),
      skills: rawSkills.map(toSkillMeta).filter((s): s is SkillMeta => s !== undefined),
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createSkillsSource(input: SkillsSourceInput): Source<SkillsSourcePayload> {
  return {
    key: 'fragment:skills',
    codec,
    load: async () => {
      if (input.skills === undefined) {
        return { _tag: 'Unavailable', reason: 'skills are not loaded' } as Unavailable
      }
      const text = skillsBlock(input.skills, input.cwd)
      return { text, skills: input.skills }
    },
    baseline: (payload) => payload.text,
  }
}
