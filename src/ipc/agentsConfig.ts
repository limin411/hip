import { invoke } from '@tauri-apps/api/core'
import type { AgentsConfig } from '@hip/protocol'

export async function getAgentsConfig(): Promise<AgentsConfig> {
  const raw = await invoke<string>('get_agents_config')
  if (!raw.trim()) return { agents: [] }
  try {
    const parsed = JSON.parse(raw) as AgentsConfig
    return Array.isArray(parsed?.agents) ? parsed : { agents: [] }
  } catch {
    return { agents: [] }
  }
}

export async function setAgentsConfig(cfg: AgentsConfig): Promise<void> {
  await invoke<void>('set_agents_config', { json: JSON.stringify(cfg, null, 2) })
}
