/**
 * Install / enable preflight: detect skill id, MCP id, and capability conflicts
 * before a plugin is turned on.
 */
import type {
  ExtensionSourceRef,
  McpServerConfig,
  SkillMeta,
} from '@hip/protocol'
import { mcpCapabilityFingerprint } from '@hip/protocol'
import { resolveEffectiveConfig } from '../../config/hip-config.js'
import { parsePluginManifest, PluginManifestError } from '../plugins/parser.js'
import { synthesizePlugin } from '../plugins/synthesizer.js'
import { inspectExtensions, skillMetaFromPluginDir } from './load.js'

export type PreflightRecommendation =
  | 'keep_user_mcp_skills_only'
  | 'use_plugin_mcp'
  | 'allow_duplicate'
  | 'rename'
  | 'disable_existing'

export interface PreflightSkillConflict {
  skillId: string
  existing: ExtensionSourceRef
  incoming: ExtensionSourceRef
}

export interface PreflightMcpIdConflict {
  id: string
  existing: ExtensionSourceRef
  incoming: ExtensionSourceRef
}

export interface PreflightCapabilityConflict {
  fingerprint: string
  existingId: string
  incomingId: string
  existing: ExtensionSourceRef
  incoming: ExtensionSourceRef
}

export interface PluginEnablePreflight {
  pluginId: string
  pluginDir: string
  skillConflicts: PreflightSkillConflict[]
  mcpIdConflicts: PreflightMcpIdConflict[]
  capabilityConflicts: PreflightCapabilityConflict[]
  recommendations: PreflightRecommendation[]
  /** True when any conflict is present. */
  hasConflicts: boolean
}

function skillSourceFromMeta(meta: SkillMeta): ExtensionSourceRef {
  if (meta.scope === 'plugin') {
    return {
      kind: 'plugin_skill',
      pluginId: meta.pluginId,
      configId: meta.id,
      path: meta.dir,
    }
  }
  if (meta.scope === 'project') {
    return { kind: 'project_skill', configId: meta.id, path: meta.dir }
  }
  return { kind: 'user_skill', configId: meta.id, path: meta.dir }
}

function mcpSourceFromConfig(config: McpServerConfig): ExtensionSourceRef {
  if (config.pluginId) {
    return { kind: 'plugin_mcp', pluginId: config.pluginId, configId: config.id }
  }
  return { kind: 'user_mcp', configId: config.id }
}

/**
 * Preflight enabling a plugin at `pluginDir` for project `cwd`.
 * Compares the plugin's skills/MCP against the current registry snapshot
 * (without requiring the plugin to already be enabled).
 */
export function preflightPluginEnable(cwd: string, pluginDir: string): PluginEnablePreflight {
  const snapshot = inspectExtensions(cwd)
  const activeSkills = new Map(
    snapshot.skills.filter((s) => s.active).map((s) => [s.id, s] as const),
  )
  const activeMcp = new Map(
    snapshot.mcpServers.filter((m) => m.active).map((m) => [m.id, m] as const),
  )
  // Toml-claimed ids (including disabled/veto)
  const cfg = resolveEffectiveConfig(cwd)
  const tomlIds = new Set((cfg.mcpServers ?? []).map((s) => s.id).filter(Boolean))

  const skillConflicts: PreflightSkillConflict[] = []
  const mcpIdConflicts: PreflightMcpIdConflict[] = []
  const capabilityConflicts: PreflightCapabilityConflict[] = []
  const recommendations = new Set<PreflightRecommendation>()

  let pluginId = 'unknown'
  try {
    const manifest = parsePluginManifest(pluginDir)
    pluginId = manifest.id
    const synth = synthesizePlugin(manifest)

    for (const se of synth.skills) {
      const meta = skillMetaFromPluginDir(se.dir, se.id, se.pluginId)
      if (!meta) continue
      const existing = activeSkills.get(se.id)
      if (!existing) continue
      // Same plugin re-enable is fine
      if (
        existing.winner.kind === 'plugin_skill' &&
        existing.winner.pluginId === se.pluginId
      ) {
        continue
      }
      skillConflicts.push({
        skillId: se.id,
        existing: existing.winner,
        incoming: {
          kind: 'plugin_skill',
          pluginId: se.pluginId,
          configId: se.id,
          path: se.dir,
        },
      })
      // Project/user skills keep winning after enable — informational
      if (existing.winner.kind === 'project_skill' || existing.winner.kind === 'user_skill') {
        recommendations.add('keep_user_mcp_skills_only')
      } else {
        recommendations.add('rename')
      }
    }

    for (const mcp of synth.mcpServers) {
      const config = { ...mcp.config, pluginId: mcp.pluginId }
      const incoming: ExtensionSourceRef = {
        kind: 'plugin_mcp',
        pluginId: mcp.pluginId,
        configId: config.id,
      }

      if (tomlIds.has(config.id) || activeMcp.has(config.id)) {
        const existingRes = activeMcp.get(config.id)
        const existing = existingRes
          ? existingRes.winner
          : ({ kind: 'user_mcp', configId: config.id } as ExtensionSourceRef)
        if (existing.pluginId === mcp.pluginId) continue
        mcpIdConflicts.push({
          id: config.id,
          existing,
          incoming,
        })
        recommendations.add('keep_user_mcp_skills_only')
        recommendations.add('use_plugin_mcp')
      }

      const fp = mcpCapabilityFingerprint(config)
      for (const [id, res] of activeMcp) {
        if (id === config.id) continue
        if (res.fingerprint !== fp) continue
        if (res.winner.pluginId === mcp.pluginId) continue
        capabilityConflicts.push({
          fingerprint: fp,
          existingId: id,
          incomingId: config.id,
          existing: res.winner,
          incoming,
        })
        recommendations.add('keep_user_mcp_skills_only')
        recommendations.add('use_plugin_mcp')
        recommendations.add('allow_duplicate')
      }
    }
  } catch (e) {
    if (e instanceof PluginManifestError) {
      throw e
    }
    throw e
  }

  return {
    pluginId,
    pluginDir,
    skillConflicts,
    mcpIdConflicts,
    capabilityConflicts,
    recommendations: [...recommendations],
    hasConflicts:
      skillConflicts.length > 0 ||
      mcpIdConflicts.length > 0 ||
      capabilityConflicts.length > 0,
  }
}

/** Summarize current registry conflicts for Settings banner. */
export function summarizeRegistryConflicts(cwd: string): {
  conflicts: import('@hip/protocol').ExtensionConflict[]
  notable: import('@hip/protocol').ExtensionConflict[]
} {
  const snapshot = inspectExtensions(cwd)
  const conflicts = snapshot.conflicts
  const notable = conflicts.filter(
    (c) =>
      c.kind === 'mcp_capability_duplicate' ||
      c.kind === 'mcp_name_veto' ||
      c.kind === 'mcp_id_shadow' ||
      (c.kind === 'skill_id_shadow' &&
        (c.loser.kind === 'plugin_skill' || c.winner.kind === 'plugin_skill')),
  )
  return { conflicts, notable }
}

// silence unused helper if tree-shaken in some builds
void skillSourceFromMeta
void mcpSourceFromConfig
