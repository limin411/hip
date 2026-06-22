import { invoke } from '@tauri-apps/api/core'
import type { PluginMeta } from '@hip/protocol'

export async function listPlugins(): Promise<PluginMeta[]> {
  const raw = await invoke<string>('list_plugins')
  if (!raw.trim()) return []
  try {
    const parsed: PluginMeta[] = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function installPluginZip(zipPath: string): Promise<string> {
  return invoke<string>('install_plugin', { zipPath })
}

export async function deletePlugin(id: string): Promise<void> {
  await invoke<void>('delete_plugin', { id })
}
