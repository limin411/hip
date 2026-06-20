import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import toml from '@iarna/toml'
import type {
  HipConfig,
  McpServerConfig,
  AgentConfig,
  ProviderEntry,
  SkillEntry,
  PermissionEntry,
  McpServersConfig,
  AgentsConfig,
  ProvidersConfig,
  SkillsConfig,
  ProviderConfigEntry,
} from '@hip/protocol'

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
  delete raw.base_url
  delete raw.api_key
  return raw as unknown as ProviderEntry
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

function normalizePermissionEntry(raw: Record<string, unknown>): PermissionEntry {
  if (raw.coarse_mode !== undefined && raw.coarseMode === undefined) {
    raw.coarseMode = raw.coarse_mode
  }
  if (raw.tool_permissions !== undefined && raw.toolPermissions === undefined) {
    raw.toolPermissions = raw.tool_permissions
  }
  delete raw.coarse_mode
  delete raw.tool_permissions
  const tp = raw.toolPermissions as Record<string, unknown> | undefined
  if (tp && tp.default_mode !== undefined && tp.defaultMode === undefined) {
    tp.defaultMode = tp.default_mode
  }
  if (tp) delete tp.default_mode
  return raw as unknown as PermissionEntry
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
  const providers = obj.providers ?? obj.providers
  if (Array.isArray(providers)) {
    config.providers = (providers as Record<string, unknown>[]).map(normalizeProviderEntry)
  }

  const mcpServers = obj.mcpServers ?? obj.mcp_servers
  if (Array.isArray(mcpServers)) {
    config.mcpServers = (mcpServers as Record<string, unknown>[]).map(normalizeMcpServerEntry)
  }

  if (Array.isArray(obj.skills)) {
    config.skills = obj.skills as SkillEntry[]
  }

  const agents = obj.agents ?? obj.agents
  if (Array.isArray(agents)) {
    config.agents = (agents as Record<string, unknown>[]).map(normalizeAgentEntry)
  }

  const permissions = obj.permissions ?? obj.permissions
  if (permissions && typeof permissions === 'object') {
    config.permissions = normalizePermissionEntry(permissions as Record<string, unknown>)
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
  if (project.mcpServers !== undefined) {
    merged.mcpServers = project.mcpServers
  }
  if (project.skills !== undefined) {
    merged.skills = project.skills
  }
  if (project.agents !== undefined) {
    merged.agents = project.agents
  }
  if (project.permissions !== undefined) {
    merged.permissions = { ...global.permissions, ...project.permissions } as PermissionEntry
  }

  return merged
}

// ──────────────────────────────────────────────────────────────────
// Legacy JSON readers (inlined to avoid circular dependencies with
// session/agents/registry). Used as fallback when no hip.toml exists.
// ──────────────────────────────────────────────────────────────────

function readLegacyMcpServers(): McpServerConfig[] {
  const file = process.env.HIP_MCP_SERVERS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as McpServersConfig
    return Array.isArray(cfg?.servers) ? cfg.servers : []
  } catch {
    return []
  }
}

function readLegacyAgents(): AgentConfig[] {
  const file = process.env.HIP_AGENTS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as AgentsConfig
    return Array.isArray(cfg?.agents) ? cfg.agents : []
  } catch {
    return []
  }
}

function readLegacyProviders(): ProviderEntry[] {
  const file = process.env.HIP_PROVIDERS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as ProvidersConfig
    const providers = cfg?.providers
    if (!providers || typeof providers !== 'object') return []
    return Object.entries(providers).map(([id, entry]) => {
      const pe = entry as ProviderConfigEntry
      return {
        id,
        name: pe.custom?.name ?? id,
        baseUrl: pe.baseURL ?? '',
        enabled: pe.enabled,
      } as ProviderEntry & { enabled?: boolean }
    })
  } catch {
    return []
  }
}

function readLegacySkills(): SkillEntry[] {
  const file = process.env.HIP_SKILLS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as SkillsConfig
    const enabled = cfg?.enabled
    if (!enabled || typeof enabled !== 'object') return []
    return Object.entries(enabled).map(([id, on]) => ({
      id,
      enabled: !!on,
    }))
  } catch {
    return []
  }
}

/**
 * Build a HipConfig from legacy per-domain JSON files when no hip.toml exists.
 * This is a **read-only fallback** — the old JSON files are never modified.
 */
function buildLegacyConfig(): HipConfig {
  return {
    version: 1,
    mcpServers: readLegacyMcpServers(),
    agents: readLegacyAgents(),
    providers: readLegacyProviders(),
    skills: readLegacySkills(),
  }
}

/**
 * Resolve the effective HipConfig for a given project directory by merging
 * the global hip.toml (`HIP_CONFIG_PATH`) with a project-level hip.toml
 * (`.hip/hip.toml` relative to `cwd`).
 *
 * **Merge priority:** project-level values override global values. When neither
 * a global nor a project hip.toml exists, the function falls back to reading
 * legacy per-domain JSON config files (mcp-servers, agents, providers, skills).
 *
 * This function **never throws** — it always returns at least `{ version: 1 }`.
 *
 * @param cwd Absolute path to the project root (the working directory for the session).
 */
export function resolveEffectiveConfig(cwd: string): HipConfig {
  const globalFile = process.env.HIP_CONFIG_PATH?.trim()
  const projectFile = join(cwd, '.hip', 'hip.toml')

  const hasGlobalToml = !!(globalFile && existsSync(globalFile))
  const hasProjectToml = existsSync(projectFile)

  // No TOML files at all → fall back to legacy JSON readers
  if (!hasGlobalToml && !hasProjectToml) {
    return buildLegacyConfig()
  }

  const global = hasGlobalToml ? readHipConfig(globalFile) : { ...DEFAULT_CONFIG }
  const project = hasProjectToml ? readHipConfig(projectFile) : { ...DEFAULT_CONFIG }

  return deepMergeConfig(global, project)
}
