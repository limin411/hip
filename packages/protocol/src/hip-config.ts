/** Unified TOML config types and network policy. */
import type { ActiveModel, AgentConfig } from './providers-agents.js'
import type { McpServerConfig } from './mcp-config.js'

export interface ProviderEntry {
  id: string
  name: string
  baseUrl: string
  apiKey?: string
  enabled: boolean
}

export interface SkillEntry {
  id: string
  enabled: boolean
}

export interface HipConfig {
  version: number
  providers?: ProviderEntry[]
  activeModel?: ActiveModel
  mcpServers?: McpServerConfig[]
  skills?: SkillEntry[]
  agents?: AgentConfig[]
  /** Enable/disable state for fixed built-in agents (coder, explore, plan).
   *  Keyed by agent id; missing entries default to enabled. */
  fixedAgents?: Record<string, boolean>
  /** Agent teams defined in hip.toml under `[[teams]]`. */
  teams?: import('./team-types.js').TeamConfig[]
}

/** User-configurable network policy persisted to ~/.hip/config/network.json.
 *  All fields optional — empty config means "allow all https" (the SSRF layer still
 *  rejects private IPs and non-https URLs). */
export interface NetworkPolicyConfig {
  allowlist?: string[]
  denylist?: string[]
  maxRequestsPerMinute?: number
  maxResponseBytes?: number
}
