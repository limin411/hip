// src/ipc/secrets.ts
import { invoke } from '@tauri-apps/api/core'
import { providerKeyEnv } from '@hip/protocol'

export function isProviderKeyConfigured(providerID: string): Promise<boolean> {
  return invoke<boolean>('has_secret', { key: providerKeyEnv(providerID) })
}

export function saveProviderKey(providerID: string, value: string): Promise<void> {
  return invoke<void>('set_secret', { key: providerKeyEnv(providerID), value })
}

export function clearProviderKey(providerID: string): Promise<void> {
  return invoke<void>('delete_secret', { key: providerKeyEnv(providerID) })
}

export function restartSidecar(): Promise<number> {
  return invoke<number>('restart_sidecar')
}
