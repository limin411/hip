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

  if (Array.isArray(obj.providers)) {
    config.providers = obj.providers as ProviderEntry[]
  }
  if (Array.isArray(obj.mcpServers)) {
    config.mcpServers = obj.mcpServers as McpServerConfig[]
  }
  if (Array.isArray(obj.skills)) {
    config.skills = obj.skills as SkillEntry[]
  }
  if (Array.isArray(obj.agents)) {
    config.agents = obj.agents as AgentConfig[]
  }
  if (obj.permissions && typeof obj.permissions === 'object') {
    config.permissions = obj.permissions as PermissionEntry
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
