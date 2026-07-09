/** MCP server config (persisted in hip.toml mcpServers). */
// ──────────────────────────────────────────────────────────────────
// MCP server config (persisted as the mcpServers array in ~/.hip/config/hip.toml)
// ──────────────────────────────────────────────────────────────────

/** Transport hip uses to reach an MCP server. */
export type McpTransport = 'stdio' | 'sse' | 'http'

/** One user-configured MCP server. stdio uses command/args/env; sse/http use url/headers. */
export interface McpServerConfig {
  id: string                          // nanoid
  name: string                        // display name
  transport: McpTransport
  command?: string                    // stdio: executable (PATH name or absolute path)
  args?: string[]                     // stdio: launch args
  env?: Record<string, string>        // stdio: child-process env overrides
  url?: string                        // sse/http: endpoint URL
  headers?: Record<string, string>    // sse/http: request headers (e.g. Authorization)
  enabledTools?: string[]            // allowlist of tool names (if set, only these are exposed)
  disabledTools?: string[]           // denylist of tool names (applied after enabledTools)
  enabled: boolean
  /** Set when this server is contributed by a plugin, linking it back to the owning plugin. */
  pluginId?: string
}

