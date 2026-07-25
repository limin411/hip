/** MCP Registry market sources and catalog entries (OpenAPI-compatible). */

/** Stable source id (seeded official or user-added). */
export type McpRegistrySourceId = string

/** Sidebar tab: registry source id, or local custom servers. */
export type McpRegistryTab = 'custom' | string

export type McpRegistryInstallState = 'not_installed' | 'installed'

/** One env/header secret the user must fill before the server can connect. */
export interface McpRegistrySecretField {
  name: string
  description?: string
  isSecret?: boolean
  /** Where the value is applied. */
  target: 'env' | 'header'
}

/**
 * Draft McpServerConfig fields produced from a registry server.json package/remote.
 * `id` is minted by the FE on install.
 */
export interface McpRegistryInstallDraft {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  registryName: string
  registrySourceId: string
  registryVersion?: string
  /** Secrets / headers the user should provide (empty placeholders already set). */
  requiredSecrets: McpRegistrySecretField[]
  /** Human-readable install method label (e.g. npm, remote-http, oci). */
  method: string
}

export interface McpRegistryPackage {
  registryType?: string
  identifier?: string
  version?: string
  runtimeHint?: string
  transport?: { type?: string; url?: string }
  environmentVariables?: Array<{
    name?: string
    description?: string
    isRequired?: boolean
    isSecret?: boolean
    format?: string
    value?: string
  }>
  packageArguments?: unknown[]
  runtimeArguments?: unknown[]
}

export interface McpRegistryRemote {
  type?: string
  url?: string
  headers?: Array<{
    name?: string
    description?: string
    isRequired?: boolean
    isSecret?: boolean
    value?: string
  }>
}

export interface McpRegistryEntry {
  /** Stable key: `${marketSourceId}::${name}` */
  key: string
  marketSourceId: McpRegistrySourceId
  /** Reverse-DNS registry name, e.g. `io.github.github/github-mcp-server`. */
  name: string
  title?: string
  description?: string
  version?: string
  repositoryUrl?: string
  /** Registry status: active | deprecated | deleted */
  status?: string
  packages?: McpRegistryPackage[]
  remotes?: McpRegistryRemote[]
  installState: McpRegistryInstallState
  /** Meaningful when installState === 'installed' */
  enabled: boolean
  localServerId?: string
  installBlockedReason?: string
}

export interface McpRegistrySourceState {
  id: McpRegistrySourceId
  name: string
  description: string
  /** Registry OpenAPI base URL, e.g. https://registry.modelcontextprotocol.io */
  registryUrl: string
  enabled: boolean
  lastFetchedAt?: string
  lastError?: string
  serverCount?: number
  /** Seeded official source. */
  builtin?: boolean
  /** True when ≥1 local mcpServers entry has this registrySourceId. */
  hasInstalledServers?: boolean
}

export interface McpRegistrySnapshot {
  sources: McpRegistrySourceState[]
  entries: McpRegistryEntry[]
}

/** Official MCP Registry seed (written on first install). */
export const BUILTIN_MCP_REGISTRY_SOURCES: Record<
  string,
  {
    id: string
    name: string
    description: string
    registryUrl: string
  }
> = {
  'mcp-official': {
    id: 'mcp-official',
    name: 'MCP Official',
    description: 'Official Model Context Protocol server registry',
    registryUrl: 'https://registry.modelcontextprotocol.io',
  },
}

export const MCP_REGISTRY_OFFICIAL_ID = 'mcp-official'

/** Official GitHub MCP server name in the registry (seeded for offline first paint). */
export const GITHUB_MCP_REGISTRY_NAME = 'io.github.github/github-mcp-server'
