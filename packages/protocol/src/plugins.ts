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

/** One installed plugin, scanned from ~/.hip/plugins/<id>/.plugin/plugin.json. */
export interface PluginMeta {
  id: string                          // folder slug under ~/.hip/plugins
  name: string                        // manifest `name`
  version: string                     // manifest `version`
  description: string                 // manifest `description`
  dir: string                         // absolute plugin directory
  skills: string[]                    // skill IDs extracted from manifest
  mcpServers: McpServerConfig[]       // MCP server configs extracted from manifest
  agents: string[]                    // agent IDs extracted from manifest
  hookCount: number                   // number of hook entries declared
  /** Unique HookEvent names detected in the plugin's hooks module/JSON (best-effort scan). */
  hookEvents: string[]
}
