import { invoke } from '@tauri-apps/api/core'
import type { McpRegistrySourceState, McpRegistrySnapshot } from '@hip/protocol'

export async function listMcpRegistrySources(): Promise<McpRegistrySourceState[]> {
  const raw = await invoke<string>('list_mcp_registry_sources')
  return JSON.parse(raw) as McpRegistrySourceState[]
}

export async function setMcpRegistrySourceEnabled(
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  await invoke('set_mcp_registry_source_enabled', { sourceId, enabled })
}

export async function refreshMcpRegistryCatalog(sourceId?: string): Promise<void> {
  await invoke('refresh_mcp_registry_catalog', {
    sourceId: sourceId ?? null,
  })
}

export async function listMcpRegistryServers(): Promise<McpRegistrySnapshot> {
  const raw = await invoke<string>('list_mcp_registry_servers')
  return JSON.parse(raw) as McpRegistrySnapshot
}

export async function addMcpRegistrySource(registryUrl: string): Promise<McpRegistrySourceState> {
  const raw = await invoke<string>('add_mcp_registry_source', { registryUrl })
  return JSON.parse(raw) as McpRegistrySourceState
}

export async function removeMcpRegistrySource(sourceId: string): Promise<void> {
  await invoke('remove_mcp_registry_source', { sourceId })
}
