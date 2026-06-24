import type { ActiveModel } from '@hip/protocol'
import { readHipConfig } from './hip-config.js'

export const DEEPSEEK_DEFAULT: ActiveModel = {
  providerID: 'deepseek',
  modelID: 'deepseek-reasoner',
  baseURL: 'https://api.deepseek.com/v1',
}

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

/** Provider ids that require a native (non-OpenAI) SDK and so cannot be reached through ChatOpenAI.
 *  We BLOCKLIST rather than allowlist on purpose: the renderer (src/ipc/catalog.ts) admits any
 *  provider tagged npm '@ai-sdk/openai[-compatible]' — metadata the sidecar never sees — so a positive
 *  allowlist here would wrongly reject those valid selections. This list is best-effort and covers the
 *  common native-SDK families, NOT every provider the renderer's stricter allowlist disables; the
 *  renderer remains the primary gate. */
const NATIVE_ONLY_PROVIDERS = new Set([
  'google',
  'google-vertex',
  'google-vertex-anthropic',
  'amazon-bedrock',
  'azure',
])

/** True unless the provider is known to require a native SDK (Anthropic/Gemini/Bedrock/Vertex/Azure);
 *  unknown ids default to true so OpenAI-compatible and custom providers are never wrongly blocked. */
export function isOpenAICompatible(providerID: string): boolean {
  return !NATIVE_ONLY_PROVIDERS.has(providerID)
}

let active: ActiveModel = DEEPSEEK_DEFAULT

export function getActiveModel(): ActiveModel {
  return active
}

export function setActiveModel(m: ActiveModel): void {
  active = m
}

function providerBaseUrlFromToml(providerID: string): string | undefined {
  const cfg = readHipConfig()
  return cfg.providers?.find((p) => p.id === providerID)?.baseUrl
}

/** Initialise the process-global active model from hip.toml. */
export function loadActiveModelFromEnv(): void {
  const cfg = readHipConfig()
  const sel = cfg.activeModel
  if (sel) {
    active = { providerID: sel.providerID, modelID: sel.modelID, baseURL: sel.baseURL }
    return
  }
  active = DEEPSEEK_DEFAULT
}

/** Resolve a provider's OpenAI-compatible base URL from hip.toml; fall back to the
 *  deepseek/anthropic defaults. */
export function resolveProviderBaseURL(providerID: string): string {
  const fromToml = providerBaseUrlFromToml(providerID)
  if (fromToml) return fromToml
  return providerID === 'anthropic' ? ANTHROPIC_DEFAULT_BASE_URL : DEEPSEEK_DEFAULT.baseURL
}

/** Cheap model for a provider's auxiliary calls (titles, compaction summaries). Falls back to the
 *  caller's active model when the provider has no known cheaper variant. */
const CHEAP_MODEL: Record<string, string> = { deepseek: 'deepseek-chat', anthropic: 'claude-3-haiku-20240307' }
export function cheapModelFor(providerID: string, fallbackModelID: string): string {
  return CHEAP_MODEL[providerID] ?? fallbackModelID
}
