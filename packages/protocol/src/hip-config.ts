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
 *
 * Defaults (when unset) are intentional safety ceilings, not typical run lengths:
 * - maxSteps 800: OpenCode-style high ceiling (OpenCode default is unbounded;
 *   hermes agent.max_turns is 90). Practical stops are doom-loop / error-streak.
 * - childMaxSteps 25 / exploreChildMaxSteps 40: below hermes delegation.max_iterations (50)
 *   to bound fan-out cost; explore needs more tool rounds for codebase search.
 * - maxDepth 3: stop recursive task/dispatch nesting.
 */
export interface AgentLoopConfig {
  /**
   * Supervisor / primary agent max model steps per user turn.
   * @default 800
   */
  maxSteps?: number
  /** Generic child / task worker step budget. Default: 25. */
  childMaxSteps?: number
  /** Explore fixed-agent step budget. Default: 40. */
  exploreChildMaxSteps?: number
  /**
   * Max nested sub-agent depth. At depth >= maxDepth, task/dispatch tools are stripped.
   * @default 3
   */
  maxDepth?: number
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

/**
 * Optional `[langsmith]` section in hip.toml.
 * When `enabled = true`, the sidecar exports traces to LangSmith (LangChain auto-tracing).
 * All fields optional; env vars (`LANGSMITH_*`) still override when already set.
 *
 * ```toml
 * [langsmith]
 * enabled = true
 * api_key = "lsv2_…"
 * project = "hip"
 * endpoint = "https://eu.api.smith.langchain.com"
 * ```
 */
export interface LangSmithConfig {
  /** Master switch. Default false when section/field omitted. */
  enabled?: boolean
  /** LangSmith API key (`lsv2_…`). Prefer file mode 0600 on hip.toml. */
  apiKey?: string
  /** Project name in LangSmith UI. */
  project?: string
  /**
   * API host. Omit for default US cloud; EU workspaces use
   * `https://eu.api.smith.langchain.com`.
   */
  endpoint?: string
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
  /** Optional LangSmith tracing (observability). */
  langsmith?: LangSmithConfig
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
