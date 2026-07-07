/**
 * AgentProfileManager — dual-layer agent profile config loading.
 *
 * Global defaults from ~/.hip/config/agents.json, per-project overrides from
 * <cwd>/.hip/agents.json. Project profiles override global profiles by id;
 * global profiles override builtins by id. Invalid profiles are dropped with a
 * console warning.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from './agent-profile.js'
import { BUILTIN_PROFILES, ALL_BUILTIN_TOOLS, FIXED_AGENT_IDS } from './agent-profile.js'

// ---------------------------------------------------------------------------
// Loader types
// ---------------------------------------------------------------------------

export interface AgentProfileLoaders {
  readGlobalAgents(): { profiles?: unknown[] }
  readProjectAgents(cwd: string): { profiles?: unknown[] }
}

// ---------------------------------------------------------------------------
// Default filesystem loaders
// ---------------------------------------------------------------------------

function defaultReadGlobalAgents(): { profiles?: unknown[] } {
  try {
    const path = join(homedir(), '.hip', 'config', 'agents.json')
    const content = readFileSync(path, 'utf8')
    return JSON.parse(content) as { profiles?: unknown[] }
  } catch {
    return { profiles: [] }
  }
}

function defaultReadProjectAgents(cwd: string): { profiles?: unknown[] } {
  try {
    const path = join(cwd, '.hip', 'agents.json')
    const content = readFileSync(path, 'utf8')
    return JSON.parse(content) as { profiles?: unknown[] }
  } catch {
    return { profiles: [] }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a raw profile object and return a typed AgentProfile, or null if
 * the profile is invalid. Invalid entries trigger a console warning with the
 * reason.
 */
function validateToolArray(
  raw: unknown,
  profileId: string,
  fieldName: 'allowedTools' | 'blockedTools',
): string[] | null {
  if (!Array.isArray(raw)) {
    console.warn(`Invalid agent profile "${profileId}": ${fieldName} must be an array`)
    return null
  }
  for (const t of raw) {
    if (typeof t !== 'string' || !ALL_BUILTIN_TOOLS.includes(t)) {
      console.warn(`Invalid agent profile "${profileId}": unknown tool "${String(t)}" in ${fieldName}`)
      return null
    }
  }
  return raw as string[]
}

/**
 * Validate a raw profile object and return a typed AgentProfile, or null if
 * the profile is invalid. Invalid entries trigger a console warning with the
 * reason.
 */
function validateProfile(raw: unknown): AgentProfile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn('Invalid agent profile: expected an object')
    return null
  }

  const p = raw as Record<string, unknown>
  const id = p.id

  if (typeof id !== 'string' || id.length === 0) {
    console.warn(`Invalid agent profile: id must be a non-empty string, got ${JSON.stringify(id)}`)
    return null
  }

  if (p.mode !== 'primary' && p.mode !== 'subagent') {
    console.warn(
      `Invalid agent profile "${id}": mode must be 'primary' | 'subagent', got ${JSON.stringify(p.mode)}`,
    )
    return null
  }

  const allowedTools = p.allowedTools !== undefined ? validateToolArray(p.allowedTools, id, 'allowedTools') : undefined
  if (allowedTools === null) return null
  const blockedTools = p.blockedTools !== undefined ? validateToolArray(p.blockedTools, id, 'blockedTools') : undefined
  if (blockedTools === null) return null

  if (p.modelBinding !== undefined && p.modelBinding !== null) {
    if (typeof p.modelBinding !== 'object' || Array.isArray(p.modelBinding)) {
      console.warn(`Invalid agent profile "${id}": modelBinding must be an object`)
      return null
    }
    const mb = p.modelBinding as Record<string, unknown>
    if (typeof mb.providerID !== 'string' || mb.providerID.length === 0) {
      console.warn(`Invalid agent profile "${id}": modelBinding.providerID must be a non-empty string`)
      return null
    }
    if (typeof mb.modelID !== 'string' || mb.modelID.length === 0) {
      console.warn(`Invalid agent profile "${id}": modelBinding.modelID must be a non-empty string`)
      return null
    }
  }

  // Build the typed profile.  Name falls back to id when missing.
  return {
    id,
    name: typeof p.name === 'string' && p.name.length > 0 ? p.name : id,
    mode: p.mode as 'primary' | 'subagent',
    ...(typeof p.description === 'string' ? { description: p.description } : {}),
    ...(allowedTools && allowedTools.length > 0 ? { allowedTools } : {}),
    ...(blockedTools && blockedTools.length > 0 ? { blockedTools } : {}),
    ...(p.modelBinding != null && typeof p.modelBinding === 'object' && !Array.isArray(p.modelBinding)
      ? { modelBinding: { providerID: (p.modelBinding as Record<string, string>).providerID, modelID: (p.modelBinding as Record<string, string>).modelID } }
      : {}),
    ...(typeof p.systemPrompt === 'string' ? { systemPrompt: p.systemPrompt } : {}),
    ...(typeof p.maxSteps === 'number' && p.maxSteps > 0 ? { maxSteps: p.maxSteps } : {}),
    ...(typeof p.temperature === 'number' ? { temperature: p.temperature } : {}),
  }
}

// ---------------------------------------------------------------------------
// AgentProfileManager
// ---------------------------------------------------------------------------

export class AgentProfileManager {
  private activeProfileId = 'supervisor'
  private loaders: AgentProfileLoaders

  /**
   * @param loaders  Optional injectable loaders (test seam). Defaults to
   *                 filesystem-based loaders reading ~/.hip/config/agents.json
   *                 and <cwd>/.hip/agents.json.
   */
  constructor(loaders?: Partial<AgentProfileLoaders>) {
    this.loaders = {
      readGlobalAgents: loaders?.readGlobalAgents ?? defaultReadGlobalAgents,
      readProjectAgents: loaders?.readProjectAgents ?? defaultReadProjectAgents,
    }
  }

  /**
   * Resolve the merged profile list for a given working directory.
   *
   * Merge order (higher overrides lower):
   *   BUILTIN_PROFILES  →  global agents.json  →  project .hip/agents.json
   *
   * Profiles are matched by `id`. When a higher-layer profile shares an id
   * with a lower-layer profile, its fields SHALLOW-MERGE over the lower
   * profile (so non-overridden fields from the lower layer are preserved).
   * Invalid profiles are dropped with a console warning.
   */
  resolveConfig(cwd?: string, fixedAgents?: Record<string, boolean>): AgentProfile[] {
    const projectCwd = cwd ?? process.cwd()

    // Start with builtins
    const map = new Map<string, AgentProfile>()
    for (const bp of BUILTIN_PROFILES) {
      map.set(bp.id, { ...bp })
    }

    // Apply global overrides
    const global = this.loaders.readGlobalAgents()
    this.mergeLayer(map, global.profiles ?? [])

    // Apply project overrides
    const project = this.loaders.readProjectAgents(projectCwd)
    this.mergeLayer(map, project.profiles ?? [])

    // Filter out disabled fixed agents
    if (fixedAgents) {
      for (const id of FIXED_AGENT_IDS) {
        if (fixedAgents[id] === false) {
          map.delete(id)
        }
      }
    }

    return [...map.values()]
  }

  /**
   * Return the resolved profile list (alias for resolveConfig).
   */
  listProfiles(cwd?: string, fixedAgents?: Record<string, boolean>): AgentProfile[] {
    return this.resolveConfig(cwd, fixedAgents)
  }

  /**
   * Set the active profile by id. Returns true if the profile exists in the
   * resolved list; false otherwise.
   */
  setActiveProfile(id: string, fixedAgents?: Record<string, boolean>): boolean {
    const profiles = this.resolveConfig(undefined, fixedAgents)
    if (profiles.some((p) => p.id === id)) {
      this.activeProfileId = id
      return true
    }
    return false
  }

  /**
   * Return the currently active AgentProfile. If the active profile id is no
   * longer in the resolved list, falls back to the supervisor builtin.
   */
  getActiveProfile(fixedAgents?: Record<string, boolean>): AgentProfile {
    const profiles = this.resolveConfig(undefined, fixedAgents)
    const profile =
      profiles.find((p) => p.id === this.activeProfileId) ??
      profiles.find((p) => p.id === 'supervisor') ??
      profiles[0]
    if (!profile) {
      throw new Error('No agent profiles available — BUILTIN_PROFILES may be empty')
    }
    return profile
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Merge one layer of profiles into the accumulator map. Each raw entry is
   * validated first — invalid entries are silently dropped (with a console
   * warning emitted by validateProfile).
   */
  private mergeLayer(map: Map<string, AgentProfile>, rawProfiles: unknown[]): void {
    for (const raw of rawProfiles) {
      const profile = validateProfile(raw)
      if (!profile) continue

      const existing = map.get(profile.id)
      if (existing) {
        // Shallow merge: higher layer overrides fields of lower layer
        map.set(profile.id, { ...existing, ...profile })
      } else {
        map.set(profile.id, profile)
      }
    }
  }
}
