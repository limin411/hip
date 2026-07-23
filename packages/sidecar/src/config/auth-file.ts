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
const STANDARD_ENV_KEYS: Record<string, readonly string[]> = {
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

export type AuthKeySource = 'override' | 'auth.json' | 'standard_env' | 'hip_env'

export interface ProviderAuthResult {
  apiKey: string
  /** Where the key was resolved from (never the secret value). */
  source: AuthKeySource
}

/** Raw auth.json map entry for one provider key env name. */
export type AuthEntry =
  | { present: false }
  | { present: true; value: string | undefined }

/** Read one provider's raw auth.json entry (present even when value is empty tombstone). */
export function readAuthEntry(providerID: string, authPath: string = defaultAuthPath()): AuthEntry {
  try {
    const map = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>
    const key = providerKeyEnv(providerID)
    if (!Object.prototype.hasOwnProperty.call(map, key)) return { present: false }
    const v = map[key]
    return { present: true, value: typeof v === 'string' ? v : undefined }
  } catch {
    return { present: false }
  }
}

/**
 * Expand simple key expressions stored in auth.json (BYOK Phase D light):
 * - `$VAR` or `${VAR}` → process.env.VAR (missing → unresolved)
 * - other values used as literals
 * Shell `!command` is intentionally not supported yet (security / sandbox).
 */
export function expandKeyExpression(raw: string): string | undefined {
  const s = raw.trim()
  if (!s) return undefined
  // Exact $VAR or ${VAR}
  const exact = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(s) ?? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(s)
  if (exact) {
    const v = process.env[exact[1]]?.trim()
    return v || undefined
  }
  // Embedded ${VAR} interpolation
  if (s.includes('${')) {
    let ok = true
    const out = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
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
  return s
}

/** Read one provider's API key from auth.json. Missing/corrupt/empty → undefined. */
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
 * 1. auth.json if the key name is present (empty string = cleared tombstone → no env fallback)
 * 2. standard industry env (ANTHROPIC_API_KEY, …)
 * 3. HIP_MODEL_<ID>_API_KEY (Tauri inject / tests / legacy scripts)
 *
 * Empty/whitespace HIP env is treated as unset.
 */
export function resolveApiKey(providerID: string, authPath?: string): string | undefined {
  return resolveProviderAuth(providerID, undefined, authPath)?.apiKey
}

/**
 * Full auth resolution including source label (for diagnostics / future UI).
 * `override` wins when non-empty (probe draft keys).
 */
export function resolveProviderAuth(
  providerID: string,
  override?: string,
  authPath: string = defaultAuthPath(),
): ProviderAuthResult | undefined {
  const draft = override?.trim()
  if (draft) return { apiKey: draft, source: 'override' }

  const entry = readAuthEntry(providerID, authPath)
  if (entry.present) {
    // Tombstone: key present but empty → explicitly unconfigured; do not fall through to env.
    // Non-empty may be a literal or $VAR / ${VAR} expression (expandKeyExpression).
    const expanded = entry.value?.trim() ? expandKeyExpression(entry.value) : undefined
    if (expanded) return { apiKey: expanded, source: 'auth.json' }
    // Present but unresolved expression (missing env) or empty → no key, no env fallback.
    return undefined
  }

  const standard = resolveStandardEnvApiKey(providerID)
  if (standard) return { apiKey: standard, source: 'standard_env' }

  const hip = process.env[providerKeyEnv(providerID)]?.trim()
  if (hip) return { apiKey: hip, source: 'hip_env' }

  return undefined
}
