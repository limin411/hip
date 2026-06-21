// packages/sidecar/src/session/plugins/synthesizer.ts
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import type { PluginManifest, McpServerConfig, AgentConfig, Hook, HookEvent } from '@hip/protocol'

/** A skill config entry synthesized from a plugin manifest, with pluginId provenance. */
export interface SynthesizedSkillEntry {
  /** Skill identifier (basename of the skill directory path in the manifest). */
  id: string
  /** Absolute path to the skill directory. */
  dir: string
  /** The plugin that contributed this skill. */
  pluginId: string
}

/** An MCP server config entry synthesized from a plugin manifest, with pluginId provenance. */
export interface SynthesizedMcpEntry {
  config: McpServerConfig
  pluginId: string
}

/** An agent config entry synthesized from a plugin manifest, with pluginId provenance. */
export interface SynthesizedAgentEntry {
  config: AgentConfig
  pluginId: string
}

/** A hook entry synthesized from a plugin manifest, with pluginId provenance. */
export interface SynthesizedHookEntry {
  pluginId: string
  hooks: Hook[]
}

/** Complete synthesized output for one plugin manifest. */
export interface SynthesizedPlugin {
  pluginId: string
  skills: SynthesizedSkillEntry[]
  mcpServers: SynthesizedMcpEntry[]
  agents: SynthesizedAgentEntry[]
  hooks: SynthesizedHookEntry[]
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** The set of valid HookEvent values for validation. */
const VALID_HOOK_EVENTS: ReadonlySet<string> = new Set([
  'SessionStart',
  'TurnStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'TurnComplete',
  'Stop',
  'PermissionRequest',
  'ActivityStart',
  'ActivityEnd',
  'ActivityBudgetRequest',
])

/** Read and parse a JSON file. Returns null on any failure (missing, invalid JSON, etc.). */
function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Extract MCP server configs from a raw value: array → as-is, object → .servers array. */
function extractMcpConfigs(raw: unknown): McpServerConfig[] {
  if (Array.isArray(raw)) return raw as McpServerConfig[]
  if (typeof raw === 'object' && raw !== null) {
    const servers = (raw as Record<string, unknown>).servers
    if (Array.isArray(servers)) return servers as McpServerConfig[]
  }
  return []
}

/** Extract agent configs from a raw value: array → as-is, object → .agents array. */
function extractAgentConfigs(raw: unknown): AgentConfig[] {
  if (Array.isArray(raw)) return raw as AgentConfig[]
  if (typeof raw === 'object' && raw !== null) {
    const agents = (raw as Record<string, unknown>).agents
    if (Array.isArray(agents)) return agents as AgentConfig[]
  }
  return []
}

// ─── per-component synthesis ────────────────────────────────────────────────

function synthesizeSkills(manifest: PluginManifest): SynthesizedSkillEntry[] {
  const skills = manifest.skills
  if (skills === undefined) return []

  const paths = Array.isArray(skills) ? skills : [skills]
  const seen = new Set<string>()
  const out: SynthesizedSkillEntry[] = []

  for (const dir of paths) {
    const id = basename(dir)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, dir, pluginId: manifest.id })
  }

  return out
}

function synthesizeMcpServers(manifest: PluginManifest): SynthesizedMcpEntry[] {
  const mcpServers = manifest.mcpServers
  if (mcpServers === undefined) return []

  const configs =
    typeof mcpServers === 'string'
      ? extractMcpConfigs(readJsonFile(mcpServers))
      : mcpServers

  const seen = new Set<string>()
  const out: SynthesizedMcpEntry[] = []

  for (const config of configs) {
    if (!config.id || seen.has(config.id)) continue
    seen.add(config.id)
    out.push({ config, pluginId: manifest.id })
  }

  return out
}

function synthesizeAgents(manifest: PluginManifest): SynthesizedAgentEntry[] {
  const agents = manifest.agents
  if (agents === undefined) return []

  const configs =
    typeof agents === 'string'
      ? extractAgentConfigs(readJsonFile(agents))
      : agents

  const seen = new Set<string>()
  const out: SynthesizedAgentEntry[] = []

  for (const config of configs) {
    if (!config.id || seen.has(config.id)) continue
    seen.add(config.id)
    out.push({ config, pluginId: manifest.id })
  }

  return out
}

// ─── hooks ──────────────────────────────────────────────────────────────────

function synthesizeHooks(manifest: PluginManifest): SynthesizedHookEntry[] {
  const hooks = manifest.hooks
  if (hooks === undefined) return []

  if (Array.isArray(hooks)) {
    console.warn(
      `[synthesizer] Plugin "${manifest.id}" declares hooks as inline array — ` +
        'inline hook arrays cannot contain function handlers. ' +
        'Use a string path to a CJS module instead.',
    )
    return []
  }

  // hooks is a string (absolute path to a CJS module resolved by the parser)
  try {
    const nodeRequire = createRequire(import.meta.url)
    const raw: unknown = nodeRequire(hooks)

    // Support both module.exports = [...] and module.exports.default = [...]
    const arr: unknown = Array.isArray(raw) ? raw : (raw as Record<string, unknown> | null)?.default
    if (!Array.isArray(arr)) {
      console.warn(
        `[synthesizer] Plugin "${manifest.id}" hooks module must export an array of hooks, got ${typeof raw}`,
      )
      return []
    }

    const validHooks: Hook[] = []
    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i]
      if (typeof entry !== 'object' || entry === null) {
        console.warn(`[synthesizer] Plugin "${manifest.id}" hook[${i}]: expected an object, got ${typeof entry}`)
        continue
      }
      const e = entry as Record<string, unknown>

      if (typeof e.event !== 'string') {
        console.warn(
          `[synthesizer] Plugin "${manifest.id}" hook[${i}]: missing or invalid "event" field`,
        )
        continue
      }
      if (!VALID_HOOK_EVENTS.has(e.event)) {
        console.warn(
          `[synthesizer] Plugin "${manifest.id}" hook[${i}]: "${e.event}" is not a valid HookEvent`,
        )
        continue
      }
      if (typeof e.handler !== 'function') {
        console.warn(
          `[synthesizer] Plugin "${manifest.id}" hook[${i}] (event: ${e.event}): ` +
            `"handler" must be a function, got ${typeof e.handler}`,
        )
        continue
      }

      validHooks.push({
        event: e.event as HookEvent,
        matcher: typeof e.matcher === 'string' || Array.isArray(e.matcher) ? e.matcher as Hook['matcher'] : undefined,
        handler: e.handler as Hook['handler'],
      })
    }

    return validHooks.length > 0 ? [{ pluginId: manifest.id, hooks: validHooks }] : []
  } catch (err) {
    console.warn(
      `[synthesizer] Plugin "${manifest.id}" failed to load hooks from ${hooks}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
    return []
  }
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Synthesize config entries from a parsed plugin manifest.
 *
 * Maps manifest component declarations (skills, mcpServers, agents) to
 * concrete config entries tagged with `pluginId` provenance.  External file
 * references (string paths) are read and resolved; inline arrays are used
 * as-is.  Duplicates are merged: first occurrence wins by component id.
 */
export function synthesizePlugin(manifest: PluginManifest): SynthesizedPlugin {
  return {
    pluginId: manifest.id,
    skills: synthesizeSkills(manifest),
    mcpServers: synthesizeMcpServers(manifest),
    agents: synthesizeAgents(manifest),
    hooks: synthesizeHooks(manifest),
  }
}
