import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import toml from '@iarna/toml'
import type {
  HipConfig,
  McpServerConfig,
  AgentConfig,
  ProviderEntry,
  SkillEntry,
  ActiveModel,
  TeamConfig,
  TeamMember,
  TeamPipelineStep,
  AgentLoopConfig,
  ContextConfig,
  TerminalConfig,
  TerminalShellPref,
  TrashConfig,
  WindowConfig,
  WindowCloseAction,
  AcpHostConfig,
  PlanConfig,
  ProxyConfig,
} from '@hip/protocol'
import { isTerminalColorThemeId, isWindowCloseAction } from '@hip/protocol'
import { parseDoomLoopStrategy } from '../session/doom-loop.js'

const DEFAULT_CONFIG: HipConfig = { version: 1 }

// ── Field-level normalization helpers ──────────────────────────────
// TOML preserves snake_case keys as-is. These helpers copy snake_case
// values to their camelCase counterparts before the object is cast to
// the typed interface. Only copies when the camelCase field is unset,
// so camelCase TOML files continue to work unchanged.
// ────────────────────────────────────────────────────────────────────

function normalizeProviderEntry(raw: Record<string, unknown>): ProviderEntry {
  if (raw.base_url !== undefined && raw.baseUrl === undefined) {
    raw.baseUrl = raw.base_url
  }
  if (raw.api_key !== undefined && raw.apiKey === undefined) {
    raw.apiKey = raw.api_key
  }
  if (raw.api_kind !== undefined && raw.apiKind === undefined) {
    raw.apiKind = raw.api_kind
  }
  // Normalize/validate apiKind; drop unknown values so bad toml does not poison routing.
  if (raw.apiKind !== undefined && raw.apiKind !== 'openai' && raw.apiKind !== 'anthropic') {
    delete raw.apiKind
  }
  if (raw.enabled === undefined) {
    raw.enabled = true
  }
  delete raw.base_url
  delete raw.api_key
  delete raw.api_kind
  return raw as unknown as ProviderEntry
}

function normalizeActiveModel(raw: Record<string, unknown>): ActiveModel {
  if (raw.provider_id !== undefined && raw.providerID === undefined) {
    raw.providerID = raw.provider_id
  }
  if (raw.model_id !== undefined && raw.modelID === undefined) {
    raw.modelID = raw.model_id
  }
  if (raw.base_url !== undefined && raw.baseURL === undefined) {
    raw.baseURL = raw.base_url
  }
  delete raw.provider_id
  delete raw.model_id
  delete raw.base_url
  return raw as unknown as ActiveModel
}

function normalizeMcpServerEntry(raw: Record<string, unknown>): McpServerConfig {
  if (raw.enabled_tools !== undefined && raw.enabledTools === undefined) {
    raw.enabledTools = raw.enabled_tools
  }
  if (raw.disabled_tools !== undefined && raw.disabledTools === undefined) {
    raw.disabledTools = raw.disabled_tools
  }
  if (raw.allow_duplicate !== undefined && raw.allowDuplicate === undefined) {
    raw.allowDuplicate = raw.allow_duplicate
  }
  if (raw.plugin_id !== undefined && raw.pluginId === undefined) {
    raw.pluginId = raw.plugin_id
  }
  delete raw.enabled_tools
  delete raw.disabled_tools
  delete raw.allow_duplicate
  delete raw.plugin_id
  return raw as unknown as McpServerConfig
}

function normalizeAgentEntry(raw: Record<string, unknown>): AgentConfig {
  if (raw.bound_model !== undefined && raw.boundModel === undefined) {
    raw.boundModel = raw.bound_model
  }
  // Normalize nested BoundModel fields (provider_id→providerID, model_id→modelID)
  const bm = raw.boundModel as Record<string, unknown> | undefined
  if (bm) {
    if (bm.provider_id !== undefined && bm.providerID === undefined) {
      bm.providerID = bm.provider_id
    }
    if (bm.model_id !== undefined && bm.modelID === undefined) {
      bm.modelID = bm.model_id
    }
    delete bm.provider_id
    delete bm.model_id
  }
  if (raw.allowed_skills !== undefined && raw.allowedSkills === undefined) {
    raw.allowedSkills = raw.allowed_skills
  }
  if (raw.allowed_mcp_servers !== undefined && raw.allowedMcpServers === undefined) {
    raw.allowedMcpServers = raw.allowed_mcp_servers
  }
  if (raw.allowed_tools !== undefined && raw.allowedTools === undefined) {
    raw.allowedTools = raw.allowed_tools
  }
  delete raw.bound_model
  delete raw.allowed_skills
  delete raw.allowed_mcp_servers
  delete raw.allowed_tools
  return raw as unknown as AgentConfig
}

function normalizeTeamEntry(raw: Record<string, unknown>): TeamConfig {
  // Normalize TeamMember entries (agentId ← agent_id, customRole ← custom_role)
  const members = raw.members as Record<string, unknown>[] | undefined
  if (Array.isArray(members)) {
    for (const m of members) {
      if (m.agent_id !== undefined && m.agentId === undefined) {
        m.agentId = m.agent_id
      }
      if (m.custom_role !== undefined && m.customRole === undefined) {
        m.customRole = m.custom_role
      }
      delete m.agent_id
      delete m.custom_role
    }
    raw.members = members as unknown as TeamMember[]
  }

  // Normalize TeamPipelineStep entries (agentId ← agent_id, input_template ← inputTemplate)
  const pipeline = raw.pipeline as Record<string, unknown>[] | undefined
  if (Array.isArray(pipeline)) {
    for (const p of pipeline) {
      if (p.agent_id !== undefined && p.agentId === undefined) {
        p.agentId = p.agent_id
      }
      if (p.input_template !== undefined && p.inputTemplate === undefined) {
        p.inputTemplate = p.input_template
      }
      delete p.agent_id
      delete p.input_template
    }
    raw.pipeline = pipeline as unknown as TeamPipelineStep[]
  }

  return raw as unknown as TeamConfig
}


function normalizeContext(raw: Record<string, unknown>): ContextConfig {
  if (raw.auto_compact_percent !== undefined && raw.autoCompactPercent === undefined) {
    raw.autoCompactPercent = raw.auto_compact_percent
  }
  if (raw.subagent_compact_percent !== undefined && raw.subagentCompactPercent === undefined) {
    raw.subagentCompactPercent = raw.subagent_compact_percent
  }
  if (raw.target_keep_percent !== undefined && raw.targetKeepPercent === undefined) {
    raw.targetKeepPercent = raw.target_keep_percent
  }
  if (raw.prefire_lead_percent !== undefined && raw.prefireLeadPercent === undefined) {
    raw.prefireLeadPercent = raw.prefire_lead_percent
  }
  if (raw.two_pass !== undefined && raw.twoPass === undefined) {
    raw.twoPass = raw.two_pass
  }
  if (raw.memory_flush_before_compact !== undefined && raw.memoryFlushBeforeCompact === undefined) {
    raw.memoryFlushBeforeCompact = raw.memory_flush_before_compact
  }
  if (raw.tool_output_max_bytes !== undefined && raw.toolOutputMaxBytes === undefined) {
    raw.toolOutputMaxBytes = raw.tool_output_max_bytes
  }
  delete raw.auto_compact_percent
  delete raw.subagent_compact_percent
  delete raw.target_keep_percent
  delete raw.prefire_lead_percent
  delete raw.two_pass
  delete raw.memory_flush_before_compact
  delete raw.tool_output_max_bytes

  const out: ContextConfig = {}
  if (typeof raw.autoCompactPercent === 'number' && Number.isFinite(raw.autoCompactPercent)) {
    out.autoCompactPercent = raw.autoCompactPercent
  }
  if (typeof raw.subagentCompactPercent === 'number' && Number.isFinite(raw.subagentCompactPercent)) {
    out.subagentCompactPercent = raw.subagentCompactPercent
  }
  if (typeof raw.targetKeepPercent === 'number' && Number.isFinite(raw.targetKeepPercent)) {
    out.targetKeepPercent = raw.targetKeepPercent
  }
  if (typeof raw.prefireLeadPercent === 'number' && Number.isFinite(raw.prefireLeadPercent)) {
    out.prefireLeadPercent = raw.prefireLeadPercent
  }
  if (typeof raw.twoPass === 'boolean') out.twoPass = raw.twoPass
  if (typeof raw.memoryFlushBeforeCompact === 'boolean') {
    out.memoryFlushBeforeCompact = raw.memoryFlushBeforeCompact
  }
  if (typeof raw.toolOutputMaxBytes === 'number' && Number.isFinite(raw.toolOutputMaxBytes)) {
    out.toolOutputMaxBytes = raw.toolOutputMaxBytes
  }
  return out
}

function normalizeAgentLoop(raw: Record<string, unknown>): AgentLoopConfig {
  if (raw.max_steps !== undefined && raw.maxSteps === undefined) {
    raw.maxSteps = raw.max_steps
  }
  if (raw.child_max_steps !== undefined && raw.childMaxSteps === undefined) {
    raw.childMaxSteps = raw.child_max_steps
  }
  if (raw.explore_child_max_steps !== undefined && raw.exploreChildMaxSteps === undefined) {
    raw.exploreChildMaxSteps = raw.explore_child_max_steps
  }
  if (raw.max_depth !== undefined && raw.maxDepth === undefined) {
    raw.maxDepth = raw.max_depth
  }
  if (raw.subagent_hitl !== undefined && raw.subagentHitl === undefined) {
    raw.subagentHitl = raw.subagent_hitl
  }
  if (raw.doom_loop_strategy !== undefined && raw.doomLoopStrategy === undefined) {
    raw.doomLoopStrategy = raw.doom_loop_strategy
  }
  if (raw.idle_timeout_ms !== undefined && raw.idleTimeoutMs === undefined) {
    raw.idleTimeoutMs = raw.idle_timeout_ms
  }
  delete raw.max_steps
  delete raw.child_max_steps
  delete raw.explore_child_max_steps
  delete raw.max_depth
  delete raw.subagent_hitl
  delete raw.doom_loop_strategy
  delete raw.idle_timeout_ms

  const out: AgentLoopConfig = {}
  if (typeof raw.maxSteps === 'number') {
    out.maxSteps = raw.maxSteps
  }
  if (typeof raw.childMaxSteps === 'number') {
    out.childMaxSteps = raw.childMaxSteps
  }
  if (typeof raw.exploreChildMaxSteps === 'number') {
    out.exploreChildMaxSteps = raw.exploreChildMaxSteps
  }
  if (typeof raw.maxDepth === 'number') {
    out.maxDepth = raw.maxDepth
  }
  if (raw.subagentHitl === 'inline_partial') {
    out.subagentHitl = 'inline_partial'
  }
  if (typeof raw.doomLoopStrategy === 'string') {
    const parsed = parseDoomLoopStrategy(raw.doomLoopStrategy)
    if (parsed) out.doomLoopStrategy = parsed
  }
  if (typeof raw.idleTimeoutMs === 'number' && Number.isFinite(raw.idleTimeoutMs)) {
    out.idleTimeoutMs = raw.idleTimeoutMs
  }
  return out
}

const TERMINAL_SHELL_PREFS = new Set<TerminalShellPref>([
  'default',
  'cmd',
  'powershell',
  'pwsh',
  'bash',
  'zsh',
])

function normalizeTerminal(raw: Record<string, unknown>): TerminalConfig {
  const out: TerminalConfig = {}
  if (typeof raw.shell === 'string') {
    const shell = raw.shell.trim().toLowerCase() as TerminalShellPref
    if (TERMINAL_SHELL_PREFS.has(shell)) {
      out.shell = shell
    }
  }
  const ct = raw.colorTheme ?? raw.color_theme
  if (typeof ct === 'string') {
    const id = ct.trim().toLowerCase()
    if (isTerminalColorThemeId(id)) {
      out.colorTheme = id
    }
  }
  return out
}

function normalizeTrash(raw: Record<string, unknown>): TrashConfig {
  const out: TrashConfig = {}
  const days = raw.retentionDays ?? raw.retention_days
  if (typeof days === 'number' && Number.isFinite(days)) {
    out.retentionDays = Math.floor(days)
  }
  return out
}

function normalizeProxy(raw: Record<string, unknown>): ProxyConfig {
  const out: ProxyConfig = {}
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled
  if (typeof raw.http === 'string') out.http = raw.http.trim() || undefined
  if (typeof raw.https === 'string') out.https = raw.https.trim() || undefined
  if (typeof raw.all === 'string') out.all = raw.all.trim() || undefined
  const no = raw.noProxy ?? raw.no_proxy
  if (typeof no === 'string') out.noProxy = no.trim() || undefined
  return out
}

/** Normalize `[window]` close / tray policy (camelCase + snake_case aliases). */
function normalizeWindow(raw: Record<string, unknown>): WindowConfig {
  const out: WindowConfig = {}
  const actionRaw = raw.closeAction ?? raw.close_action
  if (typeof actionRaw === 'string') {
    const action = actionRaw.trim().toLowerCase()
    if (isWindowCloseAction(action)) {
      out.closeAction = action as WindowCloseAction
    }
  }
  const tray = raw.trayEnabled ?? raw.tray_enabled
  if (typeof tray === 'boolean') out.trayEnabled = tray
  const always = raw.trayAlwaysVisible ?? raw.tray_always_visible
  if (typeof always === 'boolean') out.trayAlwaysVisible = always
  const seen = raw.closePromptSeen ?? raw.close_prompt_seen
  if (typeof seen === 'boolean') out.closePromptSeen = seen
  const hideHint = raw.hideHintShown ?? raw.hide_hint_shown
  if (typeof hideHint === 'boolean') out.hideHintShown = hideHint
  const login = raw.launchAtLogin ?? raw.launch_at_login
  if (typeof login === 'boolean') out.launchAtLogin = login
  const startHidden = raw.startHiddenOnLogin ?? raw.start_hidden_on_login
  if (typeof startHidden === 'boolean') out.startHiddenOnLogin = startHidden
  const notify = raw.notifyOnAgentComplete ?? raw.notify_on_agent_complete
  if (typeof notify === 'boolean') out.notifyOnAgentComplete = notify
  return out
}

/** Normalize `[plan]` product knobs (camelCase + snake_case aliases). */
function normalizePlan(raw: Record<string, unknown>): PlanConfig {
  const out: PlanConfig = {}
  const soft =
    raw.softApproveOnComposer !== undefined
      ? raw.softApproveOnComposer
      : raw.soft_approve_on_composer
  if (typeof soft === 'boolean') {
    out.softApproveOnComposer = soft
  }
  return out
}

/** Normalize `[acp]` host policy (camelCase + snake_case aliases). */
function normalizeAcpHost(raw: Record<string, unknown>): AcpHostConfig {
  const out: AcpHostConfig = {}
  if (typeof raw.fsBridge === 'boolean') out.fsBridge = raw.fsBridge
  else if (typeof raw.fs_bridge === 'boolean') out.fsBridge = raw.fs_bridge
  if (typeof raw.forwardMcp === 'boolean') out.forwardMcp = raw.forwardMcp
  else if (typeof raw.forward_mcp === 'boolean') out.forwardMcp = raw.forward_mcp
  if (typeof raw.forwardHipKeys === 'boolean') out.forwardHipKeys = raw.forwardHipKeys
  else if (typeof raw.forward_hip_keys === 'boolean') out.forwardHipKeys = raw.forward_hip_keys
  const max = raw.fsReadMaxBytes ?? raw.fs_read_max_bytes
  if (typeof max === 'number' && Number.isFinite(max) && max > 0) out.fsReadMaxBytes = max
  return out
}

/** Validate a parsed TOML object against the HipConfig schema. Never throws. */
function validateConfig(parsed: unknown, filePath: string): HipConfig {
  if (!parsed || typeof parsed !== 'object') {
    console.warn(`[hip-config] Invalid config shape in ${filePath}, using defaults`)
    return { ...DEFAULT_CONFIG }
  }
  const obj = parsed as Record<string, unknown>

  if (typeof obj.version !== 'number') {
    console.warn(`[hip-config] Missing or invalid version field in ${filePath}, using defaults`)
    return { ...DEFAULT_CONFIG }
  }

  const config: HipConfig = { version: obj.version as number }

  // Accept both camelCase and snake_case top-level keys (Rust writes snake_case TOML)
  const providers = obj.providers
  if (Array.isArray(providers)) {
    config.providers = (providers as Record<string, unknown>[]).map(normalizeProviderEntry)
  }

  const activeModel = obj.activeModel ?? obj.active_model
  if (activeModel && typeof activeModel === 'object') {
    config.activeModel = normalizeActiveModel(activeModel as Record<string, unknown>)
  }

  const mcpServers = obj.mcpServers ?? obj.mcp_servers
  if (Array.isArray(mcpServers)) {
    config.mcpServers = (mcpServers as Record<string, unknown>[]).map(normalizeMcpServerEntry)
  }

  if (Array.isArray(obj.skills)) {
    config.skills = obj.skills as SkillEntry[]
  }

  const agents = obj.agents
  if (Array.isArray(agents)) {
    config.agents = (agents as Record<string, unknown>[]).map(normalizeAgentEntry)
  }

  const teams = obj.teams
  if (Array.isArray(teams)) {
    config.teams = (teams as Record<string, unknown>[]).map(normalizeTeamEntry)
  }

  const fixedAgents = obj.fixedAgents ?? obj.fixed_agents
  if (fixedAgents && typeof fixedAgents === 'object' && !Array.isArray(fixedAgents)) {
    config.fixedAgents = fixedAgents as Record<string, boolean>
  }

  const agentLoop = obj.agentLoop ?? obj.agent_loop
  if (agentLoop && typeof agentLoop === 'object' && !Array.isArray(agentLoop)) {
    config.agentLoop = normalizeAgentLoop(agentLoop as Record<string, unknown>)
  }

  const context = obj.context
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    config.context = normalizeContext(context as Record<string, unknown>)
  }

  const terminal = obj.terminal
  if (terminal && typeof terminal === 'object' && !Array.isArray(terminal)) {
    config.terminal = normalizeTerminal(terminal as Record<string, unknown>)
  }

  const trash = obj.trash
  if (trash && typeof trash === 'object' && !Array.isArray(trash)) {
    config.trash = normalizeTrash(trash as Record<string, unknown>)
  }

  const windowSec = obj.window
  if (windowSec && typeof windowSec === 'object' && !Array.isArray(windowSec)) {
    config.window = normalizeWindow(windowSec as Record<string, unknown>)
  }

  const acp = obj.acp
  if (acp && typeof acp === 'object' && !Array.isArray(acp)) {
    config.acp = normalizeAcpHost(acp as Record<string, unknown>)
  }

  const plan = obj.plan
  if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
    config.plan = normalizePlan(plan as Record<string, unknown>)
  }

  const proxy = obj.proxy
  if (proxy && typeof proxy === 'object' && !Array.isArray(proxy)) {
    config.proxy = normalizeProxy(proxy as Record<string, unknown>)
  }

  return config
}

/**
 * Read a single HipConfig from a TOML file path.
 *
 * @param configPath Absolute path to the hip.toml file. If omitted, reads from
 *   `process.env.HIP_CONFIG_PATH` (injected by the Rust shell).
 * @returns Parsed HipConfig, or default `{ version: 1 }` on any failure.
 *   This function **never throws**.
 */
export function readHipConfig(configPath?: string): HipConfig {
  const file = configPath ?? process.env.HIP_CONFIG_PATH?.trim()
  if (!file) return { ...DEFAULT_CONFIG }

  try {
    if (!existsSync(file)) return { ...DEFAULT_CONFIG }
    const raw = readFileSync(file, 'utf8')
    const parsed = toml.parse(raw)
    return validateConfig(parsed, file)
  } catch (e) {
    console.warn(
      `[hip-config] Failed to read config from ${file}: ${e instanceof Error ? e.message : e}`,
    )
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * Deep-merge two HipConfig objects. Project-level values override global values.
 * Arrays (providers, mcpServers, skills, agents) are replaced entirely when the
 * project config specifies them. Permissions is shallow-merged (project overrides
 * individual keys within the permissions object).
 */
function deepMergeConfig(global: HipConfig, project: HipConfig): HipConfig {
  const merged: HipConfig = { ...global }

  if (project.version !== undefined) {
    merged.version = project.version
  }
  if (project.providers !== undefined) {
    merged.providers = project.providers
  }
  if (project.activeModel !== undefined) {
    merged.activeModel = project.activeModel
  }
  if (project.mcpServers !== undefined) {
    merged.mcpServers = project.mcpServers
  }
  if (project.skills !== undefined) {
    merged.skills = project.skills
  }
  if (project.agents !== undefined) {
    merged.agents = project.agents
  }
  if (project.teams !== undefined) {
    merged.teams = project.teams
  }
  if (project.fixedAgents !== undefined) {
    merged.fixedAgents = project.fixedAgents
  }
  // Project agentLoop replaces global wholesale (same as activeModel / fixedAgents).
  if (project.agentLoop !== undefined) {
    merged.agentLoop = project.agentLoop
  }
  // Project context replaces global wholesale.
  if (project.context !== undefined) {
    merged.context = project.context
  }
  // Project acp replaces global wholesale (same as agentLoop).
  if (project.acp !== undefined) {
    merged.acp = project.acp
  }

  return merged
}

/** Fully-resolved ACP host defaults (no undefined fields). */
export interface ResolvedAcpHostConfig {
  fsBridge: boolean
  forwardMcp: boolean
  /** Opt-in hip→ACP API key injection. Default false. */
  forwardHipKeys: boolean
  fsReadMaxBytes: number
}

const DEFAULT_FS_READ_MAX_BYTES = 2_000_000

/**
 * Resolve `[acp]` host policy with defaults applied.
 * - `fsBridge`: true when undefined
 * - `forwardMcp`: false when undefined
 * - `forwardHipKeys`: false when undefined
 * - `fsReadMaxBytes`: 2_000_000 when undefined
 *
 * When `cwd` is provided, merges global + project `.hip/hip.toml` (project wholesale-replaces).
 * When omitted, reads only the global `HIP_CONFIG_PATH` config.
 *
 * Note: `AcpConnection` captures `fsBridge` at construct from the global config only
 * (pool is agent-keyed, not cwd-keyed). Project-level `fs_bridge=false` affects
 * `resolveAcpHostConfig(cwd).fsReadMaxBytes` / `forwardMcp` callers, but does **not**
 * re-init an already-warm child's advertise/handler kill-switch — restart or set
 * global `HIP_CONFIG_PATH` for process-wide FS disable.
 */
export function resolveAcpHostConfig(cwd?: string): ResolvedAcpHostConfig {
  const raw = cwd ? resolveEffectiveConfig(cwd).acp : readHipConfig().acp
  const max = raw?.fsReadMaxBytes
  return {
    fsBridge: raw?.fsBridge !== false,
    forwardMcp: raw?.forwardMcp === true,
    forwardHipKeys: raw?.forwardHipKeys === true,
    fsReadMaxBytes:
      typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : DEFAULT_FS_READ_MAX_BYTES,
  }
}

/**
 * Resolve the effective HipConfig for a given project directory by merging
 * the global hip.toml (`HIP_CONFIG_PATH`) with a project-level hip.toml
 * (`.hip/hip.toml` relative to `cwd`).
 *
 * **Merge priority:** project-level values override global values. MCP servers
 * are read exclusively from hip.toml.
 *
 * This function **never throws** — it always returns at least `{ version: 1 }`.
 *
 * @param cwd Absolute path to the project root (the working directory for the session).
 */
export function resolveEffectiveConfig(cwd: string): HipConfig {
  const globalFile = process.env.HIP_CONFIG_PATH?.trim()
  const projectFile = join(cwd, '.hip', 'hip.toml')

  const global = globalFile && existsSync(globalFile) ? readHipConfig(globalFile) : { ...DEFAULT_CONFIG }
  const project = existsSync(projectFile) ? readHipConfig(projectFile) : { ...DEFAULT_CONFIG }

  return deepMergeConfig(global, project)
}
