import { invoke } from '@tauri-apps/api/core'
import type { HipConfig } from '@hip/protocol'

const DEFAULT: HipConfig = { version: 1 }

/**
 * Fetch the full HipConfig from the Rust shell.
 * On any failure (missing file, corrupt data, IPC error) returns `{ version: 1 }`.
 */
export async function getHipConfig(): Promise<HipConfig> {
  try {
    const raw = await invoke<string>('get_hip_config')
    if (!raw?.trim()) return { ...DEFAULT }
    try {
      const parsed = JSON.parse(raw) as HipConfig
      // Ensure we have at least a version field
      if (typeof parsed?.version !== 'number') return { ...DEFAULT }
      return parsed
    } catch {
      return { ...DEFAULT }
    }
  } catch {
    return { ...DEFAULT }
  }
}

/**
 * Persist the full HipConfig via the Rust shell.
 * Throws on IPC failure so the caller can surface an error.
 */
export async function setHipConfig(config: HipConfig): Promise<void> {
  await invoke<void>('set_hip_config', { json: JSON.stringify(config) })
}
