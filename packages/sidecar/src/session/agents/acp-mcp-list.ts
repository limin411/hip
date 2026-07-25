import type { McpServer } from '@agentclientprotocol/sdk'
import type { McpServerConfig } from '@hip/protocol'
import { resolveAcpHostConfig } from '../../config/hip-config.js'
import { logDebug } from '../../debug-logger.js'
import { listResolvedHipMcpServers } from '../extensions/load.js'
import type { AcpAgentRuntimeCaps } from './acp-connection.js'
import { mapHipMcpToAcp } from './acp-mcp-map.js'

/**
 * MCP servers hip would expose on a **builtin** session for this cwd —
 * independent of Session / isExternalAgent / ConfigManager cache.
 *
 * Uses the same ExtensionRegistry resolution as ConfigManager:
 * 1. hip.toml `mcpServers` (global/project merge; disabled ids name-veto plugins)
 * 2. Enabled plugins' MCP only when id is free and capability not duplicated
 *
 * **Must not** be replaced by `resolveEffectiveConfig(cwd).mcpServers` alone —
 * that API omits plugin-synthesized MCP entries. Also **must not** depend on
 * `configMgr.mcpConfigs` (cleared when the session is external/ACP).
 */
export function listEnabledHipMcpServers(cwd: string): McpServerConfig[] {
  try {
    return listResolvedHipMcpServers(cwd)
  } catch {
    return []
  }
}

/**
 * Build ACP `mcpServers` for session/new | loadSession.
 * Returns `[]` when `[acp].forwardMcp` is not true (secure default).
 */
export function buildMcpServersForAcp(cwd: string, caps: AcpAgentRuntimeCaps): McpServer[] {
  const host = resolveAcpHostConfig(cwd)
  if (!host.forwardMcp) return []
  const listed = listEnabledHipMcpServers(cwd)
  const mapped = mapHipMcpToAcp(listed, caps, {
    respectAgentMcpCaps: true,
  })
  logDebug('acp', 'MCP forward', {
    listed: listed.length,
    forwarded: mapped.length,
    loadSession: caps.loadSession,
    mcpHttp: caps.mcp.http,
    mcpSse: caps.mcp.sse,
  })
  return mapped
}
