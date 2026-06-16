import { readFileSync } from 'node:fs'
import type { McpServerConfig, McpServersConfig } from '@hip/protocol'

/** Read the configured MCP servers from HIP_MCP_SERVERS_PATH. Missing/corrupt file → []. */
export function readMcpServersConfig(): McpServerConfig[] {
  const file = process.env.HIP_MCP_SERVERS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as McpServersConfig
    return Array.isArray(cfg?.servers) ? cfg.servers : []
  } catch {
    return []
  }
}
