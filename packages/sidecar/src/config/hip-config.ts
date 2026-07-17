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
  LangSmithConfig,
} from '@hip/protocol'
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
  if (raw.enabled === undefined) {
    raw.enabled = true
  }
  delete raw.base_url
  delete raw.api_key
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
  delete raw.enabled_tools
  delete raw.disabled_tools
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

function normalizeLangSmith(raw: Record<string, unknown>): LangSmithConfig {
  if (raw.api_key !== undefined && raw.apiKey === undefined) {
    raw.apiKey = raw.api_key
  }
  delete raw.api_key

  const out: LangSmithConfig = {}
  if (typeof raw.enabled === 'boolean') {
    out.enabled = raw.enabled
  }
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) {
    out.apiKey = raw.apiKey.trim()
  }
  if (typeof raw.project === 'string' && raw.project.trim()) {
    out.project = raw.project.trim()
  }
  if (typeof raw.endpoint === 'string' && raw.endpoint.trim()) {
    out.endpoint = raw.endpoint.trim()
  }
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

  const langsmith = obj.langsmith
  if (langsmith && typeof langsmith === 'object' && !Array.isArray(langsmith)) {
    config.langsmith = normalizeLangSmith(langsmith as Record<string, unknown>)
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
  // Project langsmith replaces global wholesale (same as agentLoop).
  if (project.langsmith !== undefined) {
    merged.langsmith = project.langsmith
  }

  return merged
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
