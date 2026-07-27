/**
 * Load extension sources from disk/config and resolve via ExtensionRegistry SSOT.
 * Used by ConfigManager (session tooling) and ACP MCP forward.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentConfig,
  ExtensionConflict,
  ExtensionRegistrySnapshot,
  HipConfig,
  Hook,
  McpCandidate,
  McpServerConfig,
  SkillCandidate,
  SkillMeta,
} from '@hip/protocol'
import {
  MCP_TIER,
  SKILL_TIER,
  activeMcpConfigs,
  activeSkillMetas,
  buildExtensionRegistrySnapshot,
  resolveMcpCandidates,
  resolveSkillCandidates,
} from '@hip/protocol'
import { resolveEffectiveConfig } from '../../config/hip-config.js'
import { isPluginEnabled, readPluginsConfig } from '../../config/plugins.js'
import { getBuiltinSkills } from '../product/builtin-skills.js'
import {
  parsePluginManifest,
  PluginManifestError,
  type PluginManifestDiagnostic,
} from '../plugins/parser.js'
import { synthesizePlugin } from '../plugins/synthesizer.js'
import {
  extractSkillMetaFromData,
  readEnabledMap,
  readEnabledSkills,
  readProjectSkills,
  resolveGlobalSkillsDir,
} from '../skills/registry.js'
import { parseFrontmatter } from '../skills/frontmatter.js'

/** Read a plugin skill directory's SKILL.md and build a SkillMeta with plugin provenance. */
export function skillMetaFromPluginDir(
  dir: string,
  id: string,
  pluginId: string,
): SkillMeta | null {
  try {
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) return null
    const raw = readFileSync(skillMd, 'utf8')
    const { data } = parseFrontmatter(raw)
    const name = typeof data.name === 'string' ? data.name.trim() : undefined
    if (!name) return null
    const extra = extractSkillMetaFromData(dir, data)
    return {
      id,
      name,
      description: typeof data.description === 'string' ? data.description.trim() : '',
      dir,
      scope: 'plugin',
      pluginId,
      ...extra,
    }
  } catch {
    return null
  }
}

/**
 * Build skill candidates from builtin + global + project + enabled plugins.
 * Precedence is applied by resolveSkillCandidates (project > user > plugin > builtin).
 */
export function collectSkillCandidates(
  cwd: string,
  cfg: HipConfig,
  enabledMap: Record<string, boolean>,
): SkillCandidate[] {
  const candidates: SkillCandidate[] = []

  for (const [order, s] of getBuiltinSkills().entries()) {
    candidates.push({
      id: s.id,
      meta: { ...s, scope: 'builtin' },
      source: { kind: 'builtin', configId: s.id, path: s.dir },
      tier: SKILL_TIER.builtin,
      order,
    })
  }

  const globalRoot = resolveGlobalSkillsDir()
  if (globalRoot && existsSync(globalRoot)) {
    // Global only (no cwd) — already skips hip.toml disabled ids
    const globals = readEnabledSkills(undefined, cfg)
    for (const [order, s] of globals.entries()) {
      candidates.push({
        id: s.id,
        meta: { ...s, scope: 'global' },
        source: { kind: 'user_skill', configId: s.id, path: s.dir },
        tier: SKILL_TIER.user,
        order,
      })
    }
  }

  const project = readProjectSkills(cwd, cfg)
  for (const [order, s] of project.entries()) {
    candidates.push({
      id: s.id,
      meta: { ...s, scope: 'project' },
      source: { kind: 'project_skill', configId: s.id, path: s.dir },
      tier: SKILL_TIER.project,
      order,
    })
  }

  try {
    const pluginsCfg = readPluginsConfig()
    let pluginOrder = 0
    for (const pluginDir of pluginsCfg.plugins) {
      if (!isPluginEnabled(pluginDir, pluginsCfg)) continue
      try {
        const diagnostics: PluginManifestDiagnostic[] = []
        const manifest = parsePluginManifest(pluginDir, { diagnostics })
        for (const d of diagnostics) {
          console.warn(
            `[plugin:load] id=${manifest.id} code=${d.code} dir=${pluginDir}: ${d.message}`,
          )
        }
        const synth = synthesizePlugin(manifest)
        for (const se of synth.skills) {
          if (enabledMap[se.id] === false) continue
          const meta = skillMetaFromPluginDir(se.dir, se.id, se.pluginId)
          if (!meta) continue
          candidates.push({
            id: se.id,
            meta,
            source: {
              kind: 'plugin_skill',
              pluginId: se.pluginId,
              configId: se.id,
              path: se.dir,
            },
            tier: SKILL_TIER.plugin,
            order: pluginOrder++,
          })
        }
      } catch (e) {
        if (e instanceof PluginManifestError) {
          console.warn(`[plugin:load] Skipping invalid plugin dir=${pluginDir}: ${e.message}`)
        } else {
          console.warn(
            `[plugin:load] Unexpected error loading plugin dir=${pluginDir}:`,
            e instanceof Error ? e.message : e,
          )
        }
      }
    }
  } catch {
    /* degrade: no plugins */
  }

  return candidates
}

/**
 * Build MCP candidates from hip.toml + enabled plugins.
 * Toml ids (including enabled=false) claim the name; plugins fill only free ids.
 */
export function collectMcpCandidates(cwd: string, cfg: HipConfig): McpCandidate[] {
  void cwd
  const candidates: McpCandidate[] = []
  const toml = cfg.mcpServers ?? []

  for (const [order, config] of toml.entries()) {
    if (!config.id) continue
    const enabled = config.enabled !== false
    candidates.push({
      id: config.id,
      config,
      source: {
        kind: 'user_mcp',
        configId: config.id,
      },
      tier: MCP_TIER.config,
      order,
      vetoOnly: !enabled,
      allowDuplicate: config.allowDuplicate === true,
    })
  }

  try {
    const pluginsCfg = readPluginsConfig()
    let pluginOrder = 0
    for (const pluginDir of pluginsCfg.plugins) {
      if (!isPluginEnabled(pluginDir, pluginsCfg)) continue
      try {
        const manifest = parsePluginManifest(pluginDir)
        const synth = synthesizePlugin(manifest)
        for (const mcp of synth.mcpServers) {
          const config = mcp.config
          if (!config.id) continue
          candidates.push({
            id: config.id,
            config: { ...config, pluginId: mcp.pluginId },
            source: {
              kind: 'plugin_mcp',
              pluginId: mcp.pluginId,
              configId: config.id,
              path: pluginDir,
            },
            tier: MCP_TIER.plugin,
            order: pluginOrder++,
            allowDuplicate: config.allowDuplicate === true,
          })
        }
      } catch (e) {
        if (e instanceof PluginManifestError) {
          console.warn(`[plugin:load] Skipping invalid plugin (mcp) dir=${pluginDir}: ${e.message}`)
        }
      }
    }
  } catch {
    /* degrade */
  }

  return candidates
}

export interface LoadedExtensions {
  snapshot: ExtensionRegistrySnapshot
  skills: SkillMeta[]
  mcpConfigs: McpServerConfig[]
  pluginAgents: AgentConfig[]
  conflicts: ExtensionConflict[]
  /** Hook registration side-effect payload — caller registers on HookRegistry */
  pluginHooks: Array<{ pluginId: string; hooks: Hook[] }>
}

/**
 * Full load used by ConfigManager: skills + MCP via registry, plus agents/hooks
 * from plugins (hooks still registered by the caller).
 */
export function loadExtensions(cwd: string): LoadedExtensions {
  const cfg = resolveEffectiveConfig(cwd)
  const enabledMap = readEnabledMap(cwd, cfg)

  const disabledIds = new Set(
    Object.entries(enabledMap)
      .filter(([, v]) => v === false)
      .map(([id]) => id),
  )

  const skillCandidates = collectSkillCandidates(cwd, cfg, enabledMap)
  const { skills: skillResolutions, conflicts: skillConflicts } = resolveSkillCandidates(
    skillCandidates,
    disabledIds,
  )

  const mcpCandidates = collectMcpCandidates(cwd, cfg)
  const { mcpServers: mcpResolutions, conflicts: mcpConflicts } = resolveMcpCandidates(mcpCandidates)

  const conflicts = [...skillConflicts, ...mcpConflicts]
  const snapshot = buildExtensionRegistrySnapshot(skillResolutions, mcpResolutions, conflicts)

  const pluginAgents: AgentConfig[] = []
  const pluginHooks: LoadedExtensions['pluginHooks'] = []
  try {
    const pluginsCfg = readPluginsConfig()
    for (const pluginDir of pluginsCfg.plugins) {
      if (!isPluginEnabled(pluginDir, pluginsCfg)) continue
      try {
        const manifest = parsePluginManifest(pluginDir)
        const synth = synthesizePlugin(manifest)
        for (const agent of synth.agents) pluginAgents.push(agent.config)
        for (const hookEntry of synth.hooks) {
          pluginHooks.push({ pluginId: hookEntry.pluginId, hooks: hookEntry.hooks })
        }
      } catch {
        /* already warned in collect* */
      }
    }
  } catch {
    /* ignore */
  }

  return {
    snapshot,
    skills: activeSkillMetas(snapshot),
    mcpConfigs: activeMcpConfigs(snapshot),
    pluginAgents,
    conflicts,
    pluginHooks,
  }
}

/**
 * MCP list for ACP forward / diagnostics — same resolution as session, no hooks.
 */
export function listResolvedHipMcpServers(cwd: string): McpServerConfig[] {
  const cfg = resolveEffectiveConfig(cwd)
  const { mcpServers } = resolveMcpCandidates(collectMcpCandidates(cwd, cfg))
  return mcpServers.filter((r) => r.active).map((r) => r.config)
}

/**
 * Full snapshot for inspect / Settings (no hook registration).
 */
export function inspectExtensions(cwd: string): ExtensionRegistrySnapshot {
  return loadExtensions(cwd).snapshot
}
