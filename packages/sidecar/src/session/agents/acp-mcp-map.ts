import type { McpServer } from '@agentclientprotocol/sdk'
import type { McpServerConfig } from '@hip/protocol'
import { logDebug } from '../../debug-logger.js'
import type { AcpAgentRuntimeCaps } from './acp-connection.js'

/** Policy for mapping hip MCP configs into ACP session/new|loadSession mcpServers. */
export interface McpForwardPolicy {
  /** When set, only hip servers whose `id` is in this list are forwarded. */
  allowServerIds?: string[]
  /**
   * When true (default), drop http/sse servers unless runtime caps advertise support.
   * Stdio is always allowed (no cap gate in the SDK).
   */
  respectAgentMcpCaps?: boolean
}

/**
 * Map hip `McpServerConfig[]` → ACP SDK `McpServer[]`.
 *
 * SDK shapes (required fields):
 * - stdio: `{ name, command, args[], env[] }` — no `type` field
 * - http:  `{ type:'http', name, url, headers[] }`
 * - sse:   `{ type:'sse', name, url, headers[] }`
 *
 * Rules:
 * - skip `enabled === false`
 * - skip stdio without command; skip http/sse without url (logDebug)
 * - args/env/headers default to empty arrays (SDK requires arrays)
 * - env/headers Record → `[{name,value},…]`
 * - name prefers server.name, falls back to server.id
 * - experimental ACP transport is non-goal v1 (not produced)
 * - hip enabledTools/disabledTools are NOT forwarded (capability cliff)
 */
export function mapHipMcpToAcp(
  servers: McpServerConfig[],
  caps: AcpAgentRuntimeCaps,
  policy: McpForwardPolicy = {},
): McpServer[] {
  const respectCaps = policy.respectAgentMcpCaps !== false
  const allow = policy.allowServerIds
  const out: McpServer[] = []

  for (const s of servers) {
    if (s.enabled === false) continue
    if (allow && !allow.includes(s.id)) continue

    const name = (s.name?.trim() || s.id || '').trim()
    if (!name) {
      logDebug('acp', 'skip MCP server with empty name/id', { id: s.id })
      continue
    }

    const transport = s.transport ?? 'stdio'

    if (transport === 'stdio') {
      const command = s.command?.trim()
      if (!command) {
        logDebug('acp', 'skip stdio MCP without command', { id: s.id, name })
        continue
      }
      out.push({
        name,
        command,
        args: Array.isArray(s.args) ? [...s.args] : [],
        env: recordToNameValue(s.env),
      })
      continue
    }

    if (transport === 'http') {
      if (respectCaps && !caps.mcp.http) {
        logDebug('acp', 'skip http MCP: agent does not advertise mcp.http', { id: s.id, name })
        continue
      }
      const url = s.url?.trim()
      if (!url) {
        logDebug('acp', 'skip http MCP without url', { id: s.id, name })
        continue
      }
      out.push({
        type: 'http',
        name,
        url,
        headers: recordToNameValue(s.headers),
      })
      continue
    }

    if (transport === 'sse') {
      if (respectCaps && !caps.mcp.sse) {
        logDebug('acp', 'skip sse MCP: agent does not advertise mcp.sse', { id: s.id, name })
        continue
      }
      const url = s.url?.trim()
      if (!url) {
        logDebug('acp', 'skip sse MCP without url', { id: s.id, name })
        continue
      }
      out.push({
        type: 'sse',
        name,
        url,
        headers: recordToNameValue(s.headers),
      })
      continue
    }

    // Unknown / experimental (e.g. acp) — non-goal v1
    logDebug('acp', 'skip unsupported MCP transport', { id: s.id, name, transport })
  }

  return out
}

function recordToNameValue(
  rec: Record<string, string> | undefined,
): Array<{ name: string; value: string }> {
  if (!rec || typeof rec !== 'object') return []
  return Object.entries(rec).map(([name, value]) => ({ name, value: String(value) }))
}
