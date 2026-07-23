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

/**
 * Clear a provider key using an empty-string tombstone (BYOK hot-reload).
 * Present-but-empty in auth.json means "explicitly unconfigured" so the sidecar
 * will not fall back to a stale HIP_MODEL_* env from a previous spawn.
 * Prefer this over delete_secret for provider keys.
 */
export function clearProviderKey(providerID: string): Promise<void> {
  return invoke<void>('set_secret', { key: providerKeyEnv(providerID), value: '' })
}

export function restartSidecar(): Promise<number> {
  return invoke<number>('restart_sidecar')
}

// ── Raw secret key helpers (SSH / non-provider) ──────────────────
// set_secret / delete_secret already accept raw key strings.
// has_secret_keys is the only new Tauri command (no provider_key_env mapping).

/** auth.json key for an SSH host password. */
export function sshPasswordKey(hostId: string): string {
  return `hip.ssh.${hostId}.password`
}

/** auth.json key for an SSH private-key passphrase. */
export function sshPassphraseKey(hostId: string): string {
  return `hip.ssh.${hostId}.passphrase`
}

/**
 * Raw key presence check. Keys are looked up **as-is** in auth.json
 * (no `provider_key_env` mapping). Order of returned flags matches `keys`.
 */
export async function hasSecretKeys(keys: string[]): Promise<Record<string, boolean>> {
  const flags = await invoke<boolean[]>('has_secret_keys', { keys })
  const out: Record<string, boolean> = {}
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]!] = flags[i] === true
  }
  return out
}

/** Alias → existing `set_secret` (already raw). Do NOT invent set_secret_raw in Rust. */
export function setSecretRaw(key: string, value: string): Promise<void> {
  return invoke<void>('set_secret', { key, value })
}

/** Alias → existing `delete_secret` (already raw). */
export function deleteSecretRaw(key: string): Promise<void> {
  return invoke<void>('delete_secret', { key })
}
