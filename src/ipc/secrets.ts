// src/ipc/secrets.ts
import { invoke } from '@tauri-apps/api/core'

const DEEPSEEK_KEY = 'HIP_MODEL_DEEPSEEK_API_KEY'

export function isApiKeyConfigured(): Promise<boolean> {
  return invoke<boolean>('has_secret', { key: DEEPSEEK_KEY })
}

export function saveApiKey(value: string): Promise<void> {
  return invoke<void>('set_secret', { key: DEEPSEEK_KEY, value })
}

export function clearApiKey(): Promise<void> {
  return invoke<void>('delete_secret', { key: DEEPSEEK_KEY })
}

export function restartSidecar(): Promise<number> {
  return invoke<number>('restart_sidecar')
}
