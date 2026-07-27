/**
 * Pure helpers: map ExtensionRegistry snapshot into Settings rows.
 * Prefer snapshot when available so UI matches agent resolution.
 */
import type {
  ExtensionRegistrySnapshot,
  ExtensionSourceRef,
  McpServerConfig,
  PluginMeta,
  SkillMeta,
} from '@hip/protocol'

export interface RegistryMcpRow extends McpServerConfig {
  /** Whether ExtensionRegistry keeps this server active for sessions. */
  registryActive: boolean
  sourceKind: ExtensionSourceRef['kind']
  fingerprint: string
  pluginName?: string
  pluginEnabled?: boolean
  shadowedReason?: string
}

export interface RegistrySkillRow {
  skill: SkillMeta
  registryActive: boolean
  sourceKind: ExtensionSourceRef['kind']
  pluginName?: string
  pluginEnabled?: boolean
  shadowedReason?: string
}

function pluginNameMap(plugins: PluginMeta[]): Map<string, PluginMeta> {
  return new Map(plugins.map((p) => [p.id, p]))
}

/**
 * MCP rows for Settings from a registry snapshot.
 * Includes inactive/shadowed entries so users see what lost.
 */
export function mcpRowsFromSnapshot(
  snapshot: ExtensionRegistrySnapshot,
  plugins: PluginMeta[],
): RegistryMcpRow[] {
  const byPlugin = pluginNameMap(plugins)
  return snapshot.mcpServers.map((r) => {
    const pluginId = r.winner.pluginId ?? r.config.pluginId
    const parent = pluginId ? byPlugin.get(pluginId) : undefined
    return {
      ...r.config,
      pluginId: pluginId ?? r.config.pluginId,
      registryActive: r.active,
      sourceKind: r.winner.kind,
      fingerprint: r.fingerprint,
      pluginName: parent?.name,
      pluginEnabled: parent ? parent.enabled === true : undefined,
      shadowedReason: r.active
        ? undefined
        : r.shadowedBy
          ? `shadowed by ${r.shadowedBy.kind}${r.shadowedBy.configId ? ` (${r.shadowedBy.configId})` : ''}`
          : r.config.enabled === false
            ? 'disabled'
            : 'inactive',
    }
  })
}

/**
 * Plugin-contributed MCP rows that should appear in the "plugin" section:
 * plugin_mcp winners (active or not) + config that has pluginId stamped.
 * Standalone user/project ids are excluded when `standaloneIds` is provided.
 */
export function derivePluginMcpFromSnapshot(
  snapshot: ExtensionRegistrySnapshot,
  plugins: PluginMeta[],
  standaloneIds: Set<string>,
): RegistryMcpRow[] {
  return mcpRowsFromSnapshot(snapshot, plugins).filter((row) => {
    if (row.sourceKind !== 'plugin_mcp') return false
    if (standaloneIds.has(row.id)) return false
    return true
  })
}

/**
 * Skill rows from snapshot for Settings partitions.
 */
export function skillRowsFromSnapshot(
  snapshot: ExtensionRegistrySnapshot,
  plugins: PluginMeta[],
): RegistrySkillRow[] {
  const byPlugin = pluginNameMap(plugins)
  return snapshot.skills.map((r) => {
    const pluginId = r.winner.pluginId ?? r.meta.pluginId
    const parent = pluginId ? byPlugin.get(pluginId) : undefined
    return {
      skill: {
        ...r.meta,
        scope:
          r.meta.scope ??
          (r.winner.kind === 'plugin_skill'
            ? 'plugin'
            : r.winner.kind === 'project_skill'
              ? 'project'
              : r.winner.kind === 'builtin'
                ? 'builtin'
                : 'global'),
        pluginId: pluginId ?? r.meta.pluginId,
      },
      registryActive: r.active,
      sourceKind: r.winner.kind,
      pluginName: parent?.name ?? pluginId,
      pluginEnabled: parent ? parent.enabled === true : undefined,
      shadowedReason: r.active
        ? undefined
        : r.shadowedBy
          ? `shadowed by ${r.shadowedBy.kind}`
          : 'inactive',
    }
  })
}

/**
 * Partition skills using snapshot when present; falls back to empty plugin list
 * and all active non-plugin skills as standalone.
 */
export function partitionSkillsFromSnapshot(
  snapshot: ExtensionRegistrySnapshot,
  plugins: PluginMeta[],
): {
  standalone: SkillMeta[]
  builtin: SkillMeta[]
  pluginEntries: Array<{
    skill: SkillMeta
    pluginName: string
    pluginEnabled: boolean
    registryActive: boolean
  }>
} {
  const rows = skillRowsFromSnapshot(snapshot, plugins)
  const nonPluginActive = rows.filter(
    (r) => r.sourceKind !== 'plugin_skill' && r.registryActive,
  )
  const builtin = nonPluginActive
    .filter((r) => r.sourceKind === 'builtin' || r.skill.scope === 'builtin')
    .map((r) => r.skill)
  const standalone = nonPluginActive
    .filter((r) => r.sourceKind !== 'builtin' && r.skill.scope !== 'builtin')
    .map((r) => r.skill)
  const pluginEntries = rows
    .filter((r) => r.sourceKind === 'plugin_skill')
    .map((r) => ({
      skill: r.skill,
      pluginName: r.pluginName || r.skill.pluginId || 'plugin',
      pluginEnabled: r.pluginEnabled === true,
      registryActive: r.registryActive,
    }))
  return { standalone, builtin, pluginEntries }
}
