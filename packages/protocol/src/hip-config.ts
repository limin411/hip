/** Unified TOML config types and network policy. */
import type { ActiveModel, AgentConfig, ProviderApiKind } from './providers-agents.js'
import type { McpServerConfig } from './mcp-config.js'

export type { ProviderApiKind }

export interface ProviderEntry {
  id: string
  name: string
  baseUrl: string
  /**
   * @deprecated Never used for chat BYOK. LLM keys live only in
   * `~/.hip/config/auth.json` (see docs/design/byok-spec.md). If present in
   * hip.toml it is ignored by the runtime; do not store secrets here.
   */
  apiKey?: string
  /**
   * Chat wire protocol. Optional for catalog providers (inferred from models.dev npm /
   * URL). Recommended for custom OpenAI-compatible vs Anthropic Messages hosts.
   * TOML: `apiKind` or `api_kind`.
   */
  apiKind?: ProviderApiKind
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
  /**
   * Idle timeout (ms) with no outbound activity before aborting a turn.
   * Override via env `HIP_IDLE_TIMEOUT_MS`. When unset, surface defaults apply
   * (`code` 180s, others 60s). Clamped to [5000, 1800000].
   */
  idleTimeoutMs?: number
}

/**
 * Optional `[task_runtime]` / `[taskRuntime]` section in hip.toml.
 * Controls shell background, monitor, scheduler wake, and completion auto-wake.
 */
export interface TaskRuntimeConfig {
  /** Master switch (default true when section present). */
  enabled?: boolean
  /** Allow run_script background:true (default true). */
  shellBackground?: boolean
  /** Register monitor tool (default true). */
  monitor?: boolean
  /** Fire schedules via TurnEnqueuer (default true). */
  schedulerWake?: boolean
  /** notice | auto — shell/agent completion wake (default auto, KD-25). */
  wakeMode?: 'notice' | 'auto'
  caps?: {
    agent?: number
    shell?: number
    monitor?: number
    schedule?: number
    globalRunning?: number
  }
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

/**
 * Preferred interactive shell for the code-panel Terminal tab.
 * - `default`: platform default (Windows → cmd; Unix → `$SHELL` then zsh/bash)
 * - `cmd` / `powershell` / `pwsh`: Windows shells
 * - `bash` / `zsh`: Unix shells (also tried on Windows when Git Bash etc. is installed)
 */
export type TerminalShellPref = 'default' | 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'zsh'

/**
 * Integrated terminal (xterm) color preference.
 * Independent of app chrome theme (`uiStore.theme`).
 * - `follow`: match document dark class (current default behavior)
 * - `light` / `dark`: fixed hip token-derived palettes
 * - named presets: static catalog entries (Solarized, Dracula, One Dark)
 */
export const TERMINAL_COLOR_THEME_IDS = [
  'follow',
  'light',
  'dark',
  'solarized-dark',
  'solarized-light',
  'dracula',
  'one-dark',
] as const

export type TerminalColorThemeId = (typeof TERMINAL_COLOR_THEME_IDS)[number]

/** Runtime membership (sidecar normalize + FE normalize). */
export function isTerminalColorThemeId(v: string): v is TerminalColorThemeId {
  return (TERMINAL_COLOR_THEME_IDS as readonly string[]).includes(v)
}

/**
 * Optional `[terminal]` section in hip.toml.
 *
 * ```toml
 * [terminal]
 * shell = "cmd"
 * color_theme = "dracula"   # or colorTheme
 * ```
 */
export interface TerminalConfig {
  /** Default shell for new / restarted PTY sessions. */
  shell?: TerminalShellPref
  /**
   * xterm color palette id. Omitted / unknown → `follow`.
   * JSON/TS: `colorTheme`. TOML: `color_theme` (camelCase alias accepted).
   */
  colorTheme?: TerminalColorThemeId
}

/**
 * Optional `[trash]` section in hip.toml — product recycle-bin retention.
 *
 * ```toml
 * [trash]
 * retentionDays = 7
 * ```
 */
export interface TrashConfig {
  /**
   * Days soft-deleted Chat/Code sessions (and knowledge trash) stay recoverable.
   * Default 7; clamped to [1, 365] by resolvers.
   */
  retentionDays?: number
}

/**
 * Optional `[acp]` host policy in hip.toml.
 * Controls ACP client capabilities advertised to external agents and host-side bridges.
 *
 * ```toml
 * [acp]
 * fs_bridge = true
 * forward_mcp = false   # secure default — do not hand MCP env/headers to external agents
 * fs_read_max_bytes = 2000000
 * ```
 *
 * Resolved defaults when fields are omitted: `fsBridge=true`, `forwardMcp=false`,
 * `fsReadMaxBytes=2_000_000`. Project `[acp]` wholesale-replaces global (same as langsmith).
 *
 * When `forwardMcp=true`, hip maps enabled `mcpServers` (toml + enabled plugins) into
 * ACP session/new|load. Warning: this exposes MCP commands, env, and headers to the
 * external agent process. Hip `enabledTools`/`disabledTools` are not forwarded.
 */
export interface AcpHostConfig {
  /**
   * Advertise + implement fs/read_text_file & fs/write_text_file.
   * Resolved default: true when undefined.
   * false ⇒ advertise neither (hotfix / rollback).
   */
  fsBridge?: boolean
  /**
   * Forward enabled hip + plugin MCP configs into session/new|loadSession.
   * Resolved default: **false** when undefined (secure — no silent key/header leak).
   * See README “ACP host policy”.
   */
  forwardMcp?: boolean
  /**
   * Opt-in: inject resolved hip provider API keys into ACP spawn env under
   * standard names (ANTHROPIC_API_KEY, OPENAI_API_KEY, …). Default **false**
   * (ACP agents remain self-managed). See docs/design/byok-spec.md Phase E.
   * TOML: `forward_hip_keys` / `forwardHipKeys`.
   */
  forwardHipKeys?: boolean
  /** Max bytes for one fs/read_text_file. Default 2_000_000 when undefined. */
  fsReadMaxBytes?: number
}

/**
 * Optional `[context]` section in hip.toml — compaction / token-budget policy.
 * All fields optional; omitted values keep sidecar defaults
 * (85% auto-compact, 70% subagent, 50% keep-tail, prefire lead 10, two-pass on).
 */
export interface ContextConfig {
  /** Auto-compact trigger as % of model context window. Default 85. */
  autoCompactPercent?: number
  /** Subagent auto-compact trigger %. Default 70. */
  subagentCompactPercent?: number
  /** Verbatim keep-tail target as % of window. Default 50. */
  targetKeepPercent?: number
  /**
   * Points below autoCompactPercent where background prefire (NOTE₁) starts.
   * Default 10 → prefire at 75% when auto is 85%.
   */
  prefireLeadPercent?: number
  /** Two-pass prefire compact. Default true (also killable via HIP_TWO_PASS_COMPACT=0). */
  twoPass?: boolean
  /** Phase1 memory extract before LLM compact. Default true. */
  memoryFlushBeforeCompact?: boolean
  /** Max tool-result bytes kept inline for the model. Default 40960 (40KB). */
  toolOutputMaxBytes?: number
}

/**
 * Optional `[plan]` section in hip.toml (PR-6 / KD-8 / KD-PA-1).
 * softApproveOnComposer is **deprecated** (parsed for back-compat; FE ignores).
 */
export interface PlanConfig {
  /**
   * @deprecated KD-PA-1: no product path. Composer is blocked during plan approval;
   * approve only via plan:respond. Flag may still parse from hip.toml but is ignored.
   */
  softApproveOnComposer?: boolean
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
  /** Optional context-window / compaction policy. */
  context?: ContextConfig
  /** Optional TaskRuntime (shell bg / monitor / scheduler / wake). */
  taskRuntime?: TaskRuntimeConfig
  /** Optional LangSmith tracing (observability). */
  langsmith?: LangSmithConfig
  /** Optional interactive Terminal defaults. */
  terminal?: TerminalConfig
  /** Optional product recycle-bin retention. */
  trash?: TrashConfig
  /** Optional ACP host policy (FS bridge, MCP forward). */
  acp?: AcpHostConfig
  /** Optional plan-mode product knobs (composer soft-approve, etc.). */
  plan?: PlanConfig
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
