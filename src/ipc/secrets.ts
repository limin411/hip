// src/ipc/secrets.ts
import { invoke } from '@tauri-apps/api/core'
import { providerKeyEnv } from '@hip/protocol'

/**
 * Whether a provider has a non-empty key in auth.json.
 * Uses batch `has_secrets` (Rust registers that name only — not singular `has_secret`).
 * Pass a **provider id** (e.g. `deepseek`); Rust maps it via `provider_key_env`.
 */
export async function isProviderKeyConfigured(providerID: string): Promise<boolean> {
  const map = await areProviderKeysConfigured([providerID])
  return map[providerID] === true
}

/** Batch check; keys are **provider ids**, not env-var names. */
export function areProviderKeysConfigured(ids: string[]): Promise<Record<string, boolean>> {
  return invoke<Record<string, boolean>>('has_secrets', { keys: ids })
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
