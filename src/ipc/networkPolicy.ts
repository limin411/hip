import { invoke } from '@tauri-apps/api/core'
import type { NetworkPolicyConfig } from '@hip/protocol'

const DEFAULT: NetworkPolicyConfig = {}

/**
 * Fetch the network policy from the Rust shell (~/.hip/config/network.json).
 * Returns an empty policy on missing file or parse failure.
 */
export async function getNetworkPolicy(): Promise<NetworkPolicyConfig> {
  try {
    const raw = await invoke<string>('get_network_policy')
    if (!raw?.trim()) return { ...DEFAULT }
    const parsed = JSON.parse(raw) as NetworkPolicyConfig
    return parsed
  } catch {
    return { ...DEFAULT }
  }
}

/**
 * Persist the network policy via the Rust shell.
 * Throws on IPC failure so the caller can surface an error.
 */
export async function setNetworkPolicy(config: NetworkPolicyConfig): Promise<void> {
  await invoke<void>('set_network_policy', { json: JSON.stringify(config) })
}
