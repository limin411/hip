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

/** Doom-loop corrective strategy for the agent ReAct graph (Track A). */
export type DoomLoopStrategy = 'nudge_then_pause' | 'pause_immediately' | 'auto_continue'

/**
 * Optional `[agentLoop]` section in hip.toml.
 * All fields optional — omitted values keep defaults (loop-control / doom-loop).
 */
export interface AgentLoopConfig {
  /** Generic child / task worker step budget. Default: 25. */
  childMaxSteps?: number
  /** Explore fixed-agent step budget. Default: 40. */
  exploreChildMaxSteps?: number
  /**
   * Sub-agent HITL strategy placeholder.
   * Only `inline_partial` is accepted for now (partial tool result + parent pause).
   * `escalate` remains backlog.
   */
  subagentHitl?: 'inline_partial'
  /**
   * How the graph reacts when identical tool batches repeat (doom loop).
   * - `nudge_then_pause` (default): inject nudge once, then pause for user input
   * - `pause_immediately`: pause on first doom detection (no nudge)
   * - `auto_continue`: ignore doom path; fall through to replan/error-streak/compact
   * @default 'nudge_then_pause'
   */
  doomLoopStrategy?: DoomLoopStrategy
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
  /** Optional agent-loop controls (budgets, HITL placeholder, doom strategy). */
  agentLoop?: AgentLoopConfig
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
