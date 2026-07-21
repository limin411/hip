/** Plugin manifest and installed-plugin metadata. */
import type { AgentConfig } from './providers-agents.js'
import type { McpServerConfig } from './mcp-config.js'
import type { Hook } from './hooks.js'
import type { MarketSourceId, PluginModelReviewSummary } from './marketplace.js'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: { name: string; email?: string; url?: string }
  license?: string
  keywords?: string[]
  skills?: string | string[]
  mcpServers?: McpServerConfig[] | string
  agents?: AgentConfig[] | string
  hooks?: Hook[] | string
}

export interface PluginComponentRef {
  pluginId: string
  componentType: 'skill' | 'mcp' | 'agent' | 'hook'
  componentId: string
}

/** Rich registry entry for marketplace provenance and model review. */
export interface PluginRegistryEntry {
  id: string
  dir?: string
  marketSourceId?: MarketSourceId | string
  marketPluginName?: string
  installUrl?: string
  installSha?: string
  installedAt?: string
  modelReview?: PluginModelReviewSummary
}

/**
 * Plugin registry (`~/.hip/config/hip-plugins.json`).
 * `plugins` = absolute directory paths the sidecar loads.
 * `enabled` = per-id switches (folder slug). Missing id ⇒ enabled when registered.
 */
export interface PluginsConfig {
  plugins: string[]
  /** Keyed by plugin folder id/slug. Explicit `false` disables session load. */
  enabled?: Record<string, boolean>
  /** Optional provenance / review metadata per plugin id. */
  entries?: PluginRegistryEntry[]
}

/** One installed plugin, scanned from ~/.hip/plugins/<id>/.plugin/plugin.json
 *  (optionally enriched by PLUGIN.md frontmatter for marketplace display). */
export interface PluginMeta {
  id: string                          // folder slug under ~/.hip/plugins
  name: string                        // manifest `name`
  version: string                     // manifest `version`
  description: string                 // PLUGIN.md description if set, else manifest
  dir: string                         // absolute plugin directory
  skills: string[]                    // skill IDs extracted from manifest
  mcpServers: McpServerConfig[]       // MCP server configs extracted from manifest
  agents: string[]                    // agent IDs extracted from manifest
  hookCount: number                   // number of hook entries declared
  /** Unique HookEvent names detected in the plugin's hooks module/JSON (best-effort scan). */
  hookEvents: string[]
  /**
   * Whether the sidecar should load this plugin into sessions.
   * True when path is registered and enabled[id] is not false.
   */
  enabled: boolean
  /** Marketplace display: author display name (PLUGIN.md or plugin.json). */
  author?: string
  license?: string
  keywords?: string[]
  /** Install / docs URL from PLUGIN.md `source.url` or plugin.json author.url. */
  sourceUrl?: string
  /** github | local | url | builtin (PLUGIN.md source.type). */
  sourceType?: string
  /** True when PLUGIN.md exists at the plugin root. */
  hasPluginMd?: boolean
  /** Marketplace source this plugin was downloaded from (if any). */
  marketSourceId?: MarketSourceId | string
  /** Catalog plugin name at install time. */
  marketPluginName?: string
  /** Last model-review summary from marketplace install. */
  modelReview?: PluginModelReviewSummary
}
