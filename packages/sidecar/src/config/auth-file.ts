import { execSync } from 'node:child_process'
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

/**
 * Industry-standard API key env vars (Pi / OpenCode style).
 * Used only when auth.json has no entry for the provider (including no tombstone).
 * See docs/design/byok-spec.md §3.1.
 */
export const STANDARD_ENV_KEYS: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'],
  openai: ['OPENAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  xai: ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  togetherai: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  deepinfra: ['DEEPINFRA_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  minimax: ['MINIMAX_API_KEY'],
  'minimax-cn': ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'],
  'minimax-cn-coding-plan': ['MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY'],
  zhipuai: ['ZHIPUAI_API_KEY', 'ZAI_API_KEY'],
  siliconflow: ['SILICONFLOW_API_KEY'],
  huggingface: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
  'amazon-bedrock': ['AWS_BEARER_TOKEN_BEDROCK'],
  azure: ['AZURE_OPENAI_API_KEY', 'AZURE_API_KEY'],
}

/** Primary standard env name for a provider (ACP forward / UI hints). */
export function primaryStandardEnv(providerID: string): string | undefined {
  return STANDARD_ENV_KEYS[providerID]?.[0]
}

export type AuthKeySource = 'override' | 'auth.json' | 'oauth' | 'standard_env' | 'hip_env' | 'command'

export interface ProviderAuthResult {
  apiKey: string
  /** Where the key was resolved from (never the secret value). */
  source: AuthKeySource
  /** Provider-scoped non-secret env from credential.env (Cloudflare account, Azure resource, …). */
  env?: Record<string, string>
}

/** Stored API-key credential (auth.json `credentials` map). */
export interface ApiKeyCredential {
  type: 'api_key'
  key?: string
  /** Provider-scoped env/config (account ids, resource names). Merged into result.env. */
  env?: Record<string, string>
}

/** Stored OAuth credential (auth.json `credentials` map). */
export interface OAuthCredential {
  type: 'oauth'
  access: string
  refresh?: string
  /** Epoch ms; when past, credential is treated as expired until re-login. */
  expires: number
  env?: Record<string, string>
  meta?: Record<string, string>
}

export type StoredCredential = ApiKeyCredential | OAuthCredential

/** Raw auth.json map entry for one provider flat key env name. */
export type AuthEntry =
  | { present: false }
  | { present: true; value: string | undefined }

const RESERVED_AUTH_KEYS = new Set(['version', 'credentials'])

/** Process-lifetime cache for `!command` key expansions. */
const commandCache = new Map<string, string>()

/** Test-only: clear `!command` cache. */
export function resetAuthCommandCacheForTests(): void {
  commandCache.clear()
}

function readAuthFileRaw(authPath: string): Record<string, unknown> {
  try {
    const map = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

/** Read typed credentials map from auth.json (`credentials` object). */
export function readCredentialsMap(authPath: string = defaultAuthPath()): Record<string, StoredCredential> {
  const map = readAuthFileRaw(authPath)
  const creds = map.credentials
  if (!creds || typeof creds !== 'object' || Array.isArray(creds)) return {}
  const out: Record<string, StoredCredential> = {}
  for (const [id, raw] of Object.entries(creds as Record<string, unknown>)) {
    const c = parseStoredCredential(raw)
    if (c) out[id] = c
  }
  return out
}

function parseStoredCredential(raw: unknown): StoredCredential | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  if (o.type === 'oauth') {
    if (typeof o.access !== 'string' || !o.access.trim()) return undefined
    const expires = typeof o.expires === 'number' && Number.isFinite(o.expires) ? o.expires : 0
    return {
      type: 'oauth',
      access: o.access,
      refresh: typeof o.refresh === 'string' ? o.refresh : undefined,
      expires,
      env: normalizeEnvBag(o.env),
      meta: normalizeEnvBag(o.meta),
    }
  }
  if (o.type === 'api_key' || o.type === 'api-key' || o.key !== undefined) {
    return {
      type: 'api_key',
      key: typeof o.key === 'string' ? o.key : undefined,
      env: normalizeEnvBag(o.env),
    }
  }
  return undefined
}

function normalizeEnvBag(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** Read one provider's raw auth.json flat entry (present even when value is empty tombstone). */
export function readAuthEntry(providerID: string, authPath: string = defaultAuthPath()): AuthEntry {
  try {
    const map = readAuthFileRaw(authPath)
    const key = providerKeyEnv(providerID)
    if (!Object.prototype.hasOwnProperty.call(map, key)) return { present: false }
    const v = map[key]
    return { present: true, value: typeof v === 'string' ? v : undefined }
  } catch {
    return { present: false }
  }
}

/**
 * Expand key expressions stored in auth.json (BYOK Phase D):
 * - `$VAR` / `${VAR}` → process.env
 * - `!command` → shell stdout (process-lifetime cache); disable with HIP_AUTH_ALLOW_CMD=0
 * - `$!…` → literal string starting with `!` (no command execution)
 * - other → literal
 */
export function expandKeyExpression(raw: string): string | undefined {
  const s = raw.trim()
  if (!s) return undefined

  // Literal bang prefix escape (Pi-compatible): $!foo → !foo without running a command.
  if (s.startsWith('$!')) {
    return expandEnvOnly('!' + s.slice(2))
  }

  // Shell command: entire value after leading `!`
  if (s.startsWith('!')) {
    if (process.env.HIP_AUTH_ALLOW_CMD === '0') return undefined
    const cmd = s.slice(1).trim()
    if (!cmd) return undefined
    return runAuthCommand(cmd)
  }

  return expandEnvOnly(s)
}

/** Env interpolation only (no shell). */
function expandEnvOnly(s: string): string | undefined {
  const t0 = s.trim()
  if (!t0) return undefined
  // Exact $VAR or ${VAR}
  const exact = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(t0) ?? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(t0)
  if (exact) {
    const v = process.env[exact[1]]?.trim()
    return v || undefined
  }
  // Embedded ${VAR} interpolation
  if (t0.includes('${')) {
    let ok = true
    const out = t0.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      const v = process.env[name]
      if (v === undefined || v === '') {
        ok = false
        return ''
      }
      return v
    })
    const t = out.trim()
    return ok && t ? t : undefined
  }
  return t0
}

function runAuthCommand(cmd: string): string | undefined {
  const cached = commandCache.get(cmd)
  if (cached !== undefined) return cached
  try {
    const out = execSync(cmd, {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    const t = out.trim()
    if (!t) return undefined
    commandCache.set(cmd, t)
    return t
  } catch {
    return undefined
  }
}

/** Read one provider's API key from auth.json flat map. Missing/corrupt/empty → undefined. */
export function readAuthKey(providerID: string, authPath: string = defaultAuthPath()): string | undefined {
  const entry = readAuthEntry(providerID, authPath)
  if (!entry.present) return undefined
  const raw = entry.value?.trim()
  if (!raw) return undefined
  return expandKeyExpression(raw)
}

/** Resolve standard industry env vars for a provider (first non-empty wins). */
export function resolveStandardEnvApiKey(providerID: string): string | undefined {
  const names = STANDARD_ENV_KEYS[providerID]
  if (!names) return undefined
  for (const name of names) {
    const v = process.env[name]?.trim()
    if (v) return v
  }
  return undefined
}

/**
 * Resolve a provider's API key with BYOK priority (docs/design/byok-spec.md §3.1):
 * 1. override
 * 2. credentials[providerId] (api_key / oauth)
 * 3. flat HIP_MODEL_* auth.json entry (tombstone blocks env)
 * 4. standard industry env
 * 5. HIP_MODEL_* process env
 */
export function resolveApiKey(providerID: string, authPath?: string): string | undefined {
  return resolveProviderAuth(providerID, undefined, authPath)?.apiKey
}

/**
 * Full auth resolution including source label and optional credential.env bag.
 * `override` wins when non-empty (probe draft keys).
 */
export function resolveProviderAuth(
  providerID: string,
  override?: string,
  authPath: string = defaultAuthPath(),
): ProviderAuthResult | undefined {
  const draft = override?.trim()
  if (draft) return { apiKey: draft, source: 'override' }

  // Typed credentials map (v2)
  const stored = readCredentialsMap(authPath)[providerID]
  if (stored) {
    if (stored.type === 'oauth') {
      if (Date.now() >= stored.expires) {
        // Expired: do not fall through to env (stored credential owns the provider).
        return undefined
      }
      const access = stored.access.trim()
      if (!access) return undefined
      return { apiKey: access, source: 'oauth', env: stored.env }
    }
    // api_key credential
    const raw = stored.key?.trim()
    if (!raw) return undefined
    const expanded = expandKeyExpression(raw)
    if (!expanded) return undefined
    const source: AuthKeySource = raw.startsWith('!') && !raw.startsWith('$!') ? 'command' : 'auth.json'
    return { apiKey: expanded, source, env: stored.env }
  }

  const entry = readAuthEntry(providerID, authPath)
  if (entry.present) {
    // Tombstone: key present but empty → explicitly unconfigured; do not fall through to env.
    const raw = entry.value?.trim()
    if (!raw) return undefined
    const expanded = expandKeyExpression(raw)
    if (!expanded) return undefined
    const source: AuthKeySource = raw.startsWith('!') && !raw.startsWith('$!') ? 'command' : 'auth.json'
    return { apiKey: expanded, source }
  }

  const standard = resolveStandardEnvApiKey(providerID)
  if (standard) return { apiKey: standard, source: 'standard_env' }

  const hip = process.env[providerKeyEnv(providerID)]?.trim()
  if (hip) return { apiKey: hip, source: 'hip_env' }

  return undefined
}

/**
 * Build env vars to inject into ACP (or other) children when host opts into
 * `forwardHipKeys`. Maps resolved hip keys onto standard env names.
 * Never overwrites keys already set on `base`.
 */
export function buildHipKeyForwardEnv(
  base: NodeJS.ProcessEnv = process.env,
  authPath?: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  const ids = new Set([
    ...Object.keys(STANDARD_ENV_KEYS),
    ...Object.keys(readCredentialsMap(authPath)),
  ])
  for (const providerID of ids) {
    const envName = primaryStandardEnv(providerID)
    if (!envName) continue
    if (base[envName]?.trim() || out[envName]) continue
    const auth = resolveProviderAuth(providerID, undefined, authPath)
    if (!auth?.apiKey) continue
    out[envName] = auth.apiKey
    if (auth.env) {
      for (const [k, v] of Object.entries(auth.env)) {
        if (!base[k]?.trim() && !out[k]) out[k] = v
      }
    }
  }
  return out
}

/** @internal Reserved top-level auth.json keys (not provider secrets). */
export function isReservedAuthKey(key: string): boolean {
  return RESERVED_AUTH_KEYS.has(key)
}
