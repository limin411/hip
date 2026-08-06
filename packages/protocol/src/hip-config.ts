/** Unified TOML config types and network policy. */
import type { ActiveModel, AgentConfig, ProviderApiKind } from './providers-agents.js'
import type { McpServerConfig } from './mcp-config.js'
import type { ContextGateMode } from './token-estimation/index.js'

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
 * Code-block color preference for syntax-highlighted fenced code blocks.
 * Independent of the app chrome theme (`uiStore.theme`).
 * - `follow`: match document dark class (current default behavior)
 * - `light` / `dark`: fixed GitHub Light / GitHub Dark palettes, including
 *   code-block background / border / text so contrast holds on either app theme
 */
export const CODE_BLOCK_COLOR_THEME_IDS = ['follow', 'light', 'dark'] as const

export type CodeBlockColorThemeId = (typeof CODE_BLOCK_COLOR_THEME_IDS)[number]

/** Runtime membership (FE normalize + sidecar normalize). */
export function isCodeBlockColorThemeId(v: string): v is CodeBlockColorThemeId {
  return (CODE_BLOCK_COLOR_THEME_IDS as readonly string[]).includes(v)
}

/**
 * Optional `[code_block]` section in hip.toml.
 *
 * ```toml
 * [code_block]
 * color_theme = "dark"   # or colorTheme
 * ```
 */
export interface CodeBlockConfig {
  /**
   * Code-block color scheme id. Omitted / unknown → `follow`.
   * JSON/TS: `colorTheme`. TOML: `color_theme` (camelCase alias accepted).
   */
  colorTheme?: CodeBlockColorThemeId
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
 * Close-window behavior for the main desktop shell.
 * - `hide` — hide to system tray (sidecar / agents keep running)
 * - `quit` — exit the app (historical default when unset)
 * - `ask` — prompt each time (Phase 2 UI; accepted in config for forward-compat)
 */
export type WindowCloseAction = 'hide' | 'quit' | 'ask'

export const WINDOW_CLOSE_ACTIONS: readonly WindowCloseAction[] = ['hide', 'quit', 'ask'] as const

export function isWindowCloseAction(v: string): v is WindowCloseAction {
  return (WINDOW_CLOSE_ACTIONS as readonly string[]).includes(v)
}

/**
 * Optional `[window]` section in hip.toml — close behavior & system tray.
 *
 * ```toml
 * [window]
 * closeAction = "hide"   # hide | quit | ask
 * trayEnabled = true
 * ```
 *
 * Resolved defaults when omitted (Phase 1 zero-surprise for existing installs):
 * `closeAction=quit`, `trayEnabled=false`.
 */
export interface WindowConfig {
  /** Behavior when the user closes the main window chrome. */
  closeAction?: WindowCloseAction
  /** Create a system tray icon. When false, close always quits. */
  trayEnabled?: boolean
  /**
   * If true, tray exists whenever trayEnabled.
   * Phase 1: always treated as true when tray is enabled (field reserved).
   */
  trayAlwaysVisible?: boolean
  /** User completed first-close dialog (Phase 2). */
  closePromptSeen?: boolean
  /** First hide-to-tray system hint already shown (Phase 2). */
  hideHintShown?: boolean
  /** Launch hip at OS login (Phase 3). */
  launchAtLogin?: boolean
  /**
   * When launched via login item / `--autostart`, start with the main window hidden
   * (tray only). Default true when omitted and launchAtLogin is on.
   */
  startHiddenOnLogin?: boolean
  /** OS notification when an agent turn finishes while hidden (Phase 3). */
  notifyOnAgentComplete?: boolean
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
 * `fsReadMaxBytes=2_000_000`. Project `[acp]` wholesale-replaces global (same as agentLoop).
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

export const CONTEXT_GATE_MODES: readonly ContextGateMode[] = [
  'percent',
  'usable',
  'percent_minus_buffer',
] as const

export function isContextGateMode(v: unknown): v is ContextGateMode {
  return typeof v === 'string' && (CONTEXT_GATE_MODES as readonly string[]).includes(v)
}

/**
 * Parse a gate mode from config/env strings.
 * Accepts exact literals and hyphenated aliases (`percent-minus-buffer`).
 */
export function parseContextGateMode(v: unknown): ContextGateMode | undefined {
  if (typeof v !== 'string') return undefined
  const normalized = v.trim().toLowerCase().replace(/-/g, '_')
  return isContextGateMode(normalized) ? normalized : undefined
}

/**
 * Optional `[context]` section in hip.toml — compaction / token-budget policy.
 * All fields optional; omitted values keep sidecar defaults
 * (85% auto-compact, 70% subagent, 50% keep-tail, prefire lead 10, two-pass on;
 * buffer 0 / gateMode percent — KD-3).
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
  /**
   * Absolute output headroom tokens for optional buffer gate modes.
   * Default **0** (KD-3) — no double headroom on the 85% percent path.
   * Env: `HIP_CONTEXT_OUTPUT_BUFFER_TOKENS`.
   * Note: buffer ≥ window (or buffer dominating the % threshold) ⇒ gate always
   * fires; keep 0 unless dogfooding usable / percent_minus_buffer.
   */
  outputBufferTokens?: number
  /**
   * How buffer interacts with percent gates. Default `percent`.
   * Env: `HIP_CONTEXT_GATE_MODE`.
   * Resolved and stored for compact wiring; product compact still uses
   * percent-of-window via `exceedsThreshold` until a later PR switches to
   * `exceedsGate` (see ResolvedContextPolicy).
   */
  gateMode?: ContextGateMode
  /**
   * Hybrid mid-turn pressure (max full estimate, lastProvider+delta).
   * Default true; kill via `HIP_CONTEXT_HYBRID_FILL=0` (KD-19).
   * Stored for later hybrid PR; not yet applied in compactNode.
   */
  hybridFill?: boolean
  /**
   * Soft-prune newest-tool protect window (tokens). Default 40_000 in sidecar.
   * Env: HIP_CONTEXT_PRUNE_PROTECT_TOKENS.
   */
  pruneProtectTokens?: number
  /**
   * Soft-prune minimum release volume (tokens). Default 20_000 in sidecar.
   * Env: HIP_CONTEXT_PRUNE_MINIMUM_TOKENS.
   */
  pruneMinimumTokens?: number
  /**
   * Optional sliding-window token budget (KD-8 / PR-6).
   * When set, `applySlidingWindow` also triggers if estimated message tokens exceed this
   * (in addition to the maxMessages hard cap). Env: HIP_CONTEXT_SLIDING_WINDOW_MAX_TOKENS.
   */
  slidingWindowMaxTokens?: number
  /** Cache-read cost multiplier vs input. Default 0.1. Env: HIP_CONTEXT_COST_CACHE_READ_MULT. */
  costCacheReadMultiplier?: number
  /** Cache-write cost multiplier vs input. Default 1.25. Env: HIP_CONTEXT_COST_CACHE_WRITE_MULT. */
  costCacheWriteMultiplier?: number
  /**
   * Request-side soft trim of old large tool results. Default false.
   * Env: HIP_CONTEXT_SOFT_TRIM.
   */
  softTrimEnabled?: boolean
  /** Fill % threshold for soft trim when enabled. Default 50. Env: HIP_CONTEXT_SOFT_TRIM_PERCENT. */
  softTrimPercent?: number
  /** Keep last N human turns untrimmed. Default 3. Env: HIP_CONTEXT_SOFT_TRIM_KEEP_LAST_N_TURNS. */
  softTrimKeepLastNTurns?: number
  /**
   * Provider cache breakpoint policy: auto | none (aliases: off/0/false).
   * Default auto. Env: HIP_CONTEXT_CACHE_POLICY.
   */
  cachePolicy?: string
  /**
   * OpenAI prompt_cache_key mode (e.g. session). Default session.
   * Env: HIP_CONTEXT_PROMPT_CACHE_KEY.
   */
  promptCacheKey?: string
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

/** ASR recognition language for local whisper-cli (`-l`). */
export type VoiceLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko'

export const VOICE_LANGUAGES: readonly VoiceLanguage[] = ['auto', 'zh', 'en', 'ja', 'ko'] as const

export function isVoiceLanguage(v: string): v is VoiceLanguage {
  return (VOICE_LANGUAGES as readonly string[]).includes(v)
}

/** ggml whisper model id (maps to `ggml-{id}.bin`). */
export type VoiceModelId = 'tiny' | 'base' | 'small'

export const VOICE_MODEL_IDS: readonly VoiceModelId[] = ['tiny', 'base', 'small'] as const

export function isVoiceModelId(v: string): v is VoiceModelId {
  return (VOICE_MODEL_IDS as readonly string[]).includes(v)
}

/**
 * Default Hugging Face resolve URLs for whisper ggml models
 * (same catalog as `src-tauri/src/voice_models.rs`).
 */
export const DEFAULT_VOICE_MODEL_URLS: Readonly<Record<VoiceModelId, string>> = {
  tiny: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  base: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  small: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
}

/** Resolve effective download URL for a model (override wins when non-empty). */
export function resolveVoiceModelUrl(
  model: VoiceModelId,
  overrides?: Partial<Record<VoiceModelId, string>> | null,
): string {
  const raw = overrides?.[model]?.trim()
  if (raw) return raw
  return DEFAULT_VOICE_MODEL_URLS[model]
}

/**
 * Optional `[voice]` section in hip.toml — composer local dictation (whisper.cpp).
 *
 * ```toml
 * [voice]
 * enabled = false
 * input_device_id = "default"
 * input_device_label = ""
 * input_device_group_id = ""
 * language = "auto"
 * model = "base"
 * max_duration_sec = 60
 *
 * [voice.model_urls]
 * base = "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
 * ```
 *
 * Resolved defaults when omitted: **enabled=false** (opt-in; not every user needs voice),
 * device=default, language=auto, model=base, maxDurationSec=60.
 * Models are downloaded on demand in Settings (not shipped in the default package).
 */
export interface VoiceConfig {
  /** Runtime master switch (Settings). Default **false** when omitted — opt-in dictation. */
  enabled?: boolean
  /** MediaDevices deviceId, or `"default"`. */
  inputDeviceId?: string
  /** Persisted for rebind across restarts. */
  inputDeviceLabel?: string
  inputDeviceGroupId?: string
  language?: VoiceLanguage
  model?: VoiceModelId
  /** Clamp 5–120 in resolvers; default 60. */
  maxDurationSec?: number
  /**
   * Optional per-model download URL overrides (mirror / private CDN).
   * Empty / omitted keys use {@link DEFAULT_VOICE_MODEL_URLS}.
   * TOML: `[voice.model_urls]` / `modelUrls`.
   */
  modelUrls?: Partial<Record<VoiceModelId, string>>
}

/**
 * Optional `[proxy]` section in hip.toml — HTTP(S) proxy for sidecar + model downloads.
 *
 * ```toml
 * [proxy]
 * enabled = true
 * http = "http://127.0.0.1:7890"
 * https = "http://127.0.0.1:7890"
 * # all = "http://127.0.0.1:7890"   # optional fallback (ALL_PROXY)
 * no_proxy = "localhost,127.0.0.1,::1"
 * ```
 *
 * When `enabled=true`, values are injected as `HTTP_PROXY` / `HTTPS_PROXY` /
 * `ALL_PROXY` / `NO_PROXY` for the sidecar process (and used by local downloads).
 * When disabled or omitted, process/environment proxies (if any) still apply.
 */
export interface ProxyConfig {
  /** Master switch. Default false when omitted. */
  enabled?: boolean
  /** HTTP proxy URL (`HTTP_PROXY`). */
  http?: string
  /** HTTPS proxy URL (`HTTPS_PROXY`). */
  https?: string
  /** Fallback for both (`ALL_PROXY`). */
  all?: string
  /** Comma-separated hosts that bypass the proxy (`NO_PROXY`). */
  noProxy?: string
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
  /** Optional interactive Terminal defaults. */
  terminal?: TerminalConfig
  /** Optional code-block color preference. */
  codeBlock?: CodeBlockConfig
  /** Optional product recycle-bin retention. */
  trash?: TrashConfig
  /** Optional main-window close behavior & system tray. */
  window?: WindowConfig
  /** Optional ACP host policy (FS bridge, MCP forward). */
  acp?: AcpHostConfig
  /** Optional plan-mode product knobs (composer soft-approve, etc.). */
  plan?: PlanConfig
  /** Optional local voice dictation (whisper.cpp). */
  voice?: VoiceConfig
  /** Optional HTTP(S) network proxy (General Settings). */
  proxy?: ProxyConfig
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
