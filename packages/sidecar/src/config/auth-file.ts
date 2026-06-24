import { readFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { providerKeyEnv } from '@hip/protocol'

/** Default path to the file-backed secret store (mirrors Rust `src-tauri/src/auth.rs`).
 *  Single source of truth for provider API keys across the desktop app, the standalone
 *  sidecar, and the test suite. Overridable via HIP_AUTH_PATH (mirrors HIP_CONFIG_PATH
 *  / HIP_DB_PATH) so tests can isolate the file fallback. */
export function defaultAuthPath(): string {
  return process.env.HIP_AUTH_PATH?.trim() || path.join(os.homedir(), '.hip', 'config', 'auth.json')
}

/** Read one provider's API key from auth.json. A missing/corrupt file or absent key → undefined. */
export function readAuthKey(providerID: string, authPath: string = defaultAuthPath()): string | undefined {
  try {
    const map = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    const v = map[providerKeyEnv(providerID)]
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

/** Resolve a provider's API key: the Tauri-injected env var first (desktop app), then
 *  auth.json (standalone sidecar / tests). Empty/whitespace env is treated as unset, so a
 *  provider the shell injected as "" (no key) correctly falls through to "no key". */
export function resolveApiKey(providerID: string, authPath?: string): string | undefined {
  const fromEnv = process.env[providerKeyEnv(providerID)]?.trim()
  if (fromEnv) return fromEnv
  return readAuthKey(providerID, authPath)?.trim() || undefined
}
