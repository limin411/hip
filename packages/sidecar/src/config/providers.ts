import { readFileSync } from 'node:fs'
import type { ActiveModel, ProvidersConfig } from '@hip/protocol'

export const DEEPSEEK_DEFAULT: ActiveModel = {
  providerID: 'deepseek',
  modelID: 'deepseek-reasoner',
  baseURL: 'https://api.deepseek.com/v1',
}

/** Provider ids that require a native (non-OpenAI) SDK and so cannot be reached through ChatOpenAI.
 *  We BLOCKLIST rather than allowlist on purpose: the renderer (src/ipc/catalog.ts) admits any
 *  provider tagged npm '@ai-sdk/openai[-compatible]' — metadata the sidecar never sees — so a positive
 *  allowlist here would wrongly reject those valid selections. This list is best-effort and covers the
 *  common native-SDK families, NOT every provider the renderer's stricter allowlist disables; the
 *  renderer remains the primary gate. A stale/hand-edited hip-providers.json is the only way one of
 *  these reaches buildModel() — see the model-config follow-ups spec. */
const NATIVE_ONLY_PROVIDERS = new Set([
  'anthropic',
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

/** Initialise the process-global active model from HIP_PROVIDERS_PATH (call once at boot). */
export function loadActiveModelFromEnv(): void {
  const file = process.env.HIP_PROVIDERS_PATH?.trim()
  if (!file) { active = DEEPSEEK_DEFAULT; return }
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as ProvidersConfig
    const sel = cfg.activeModel
    if (!sel) { active = DEEPSEEK_DEFAULT; return }
    const baseURL = cfg.providers?.[sel.providerID]?.baseURL ?? DEEPSEEK_DEFAULT.baseURL
    active = { providerID: sel.providerID, modelID: sel.modelID, baseURL }
  } catch {
    active = DEEPSEEK_DEFAULT
  }
}
