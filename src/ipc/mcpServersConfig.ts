import { invoke } from '@tauri-apps/api/core'
import type { McpServersConfig } from '@hip/protocol'

export async function getMcpServersConfig(): Promise<McpServersConfig> {
  const raw = await invoke<string>('get_mcp_servers_config')
  if (!raw.trim()) return { servers: [] }
  try {
    const parsed = JSON.parse(raw) as McpServersConfig
    return Array.isArray(parsed?.servers) ? parsed : { servers: [] }
  } catch {
    return { servers: [] }
  }
}

export async function setMcpServersConfig(cfg: McpServersConfig): Promise<void> {
  await invoke<void>('set_mcp_servers_config', { json: JSON.stringify(cfg, null, 2) })
}
