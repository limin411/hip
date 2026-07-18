/** Plugin manifest and installed-plugin metadata. */
import type { AgentConfig } from './providers-agents.js'
import type { McpServerConfig } from './mcp-config.js'
import type { Hook } from './hooks.js'

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

export interface PluginsConfig { plugins: string[] }

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
}
