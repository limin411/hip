// src/ipc/providersConfig.ts
import { invoke } from '@tauri-apps/api/core'
import type { ProvidersConfig } from '@hip/protocol'

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'

/** First-run seed: DeepSeek enabled + active, so existing users see no change. */
export function withDefaults(cfg: ProvidersConfig | null): ProvidersConfig {
  if (cfg && cfg.providers && Object.keys(cfg.providers).length > 0) return cfg
  return {
    providers: { deepseek: { enabled: true, baseURL: DEEPSEEK_BASE } },
    activeModel: { providerID: 'deepseek', modelID: 'deepseek-reasoner' },
  }
}

export async function getProvidersConfig(): Promise<ProvidersConfig> {
  const raw = await invoke<string>('get_providers_config')
  // Self-heal a corrupt/partially-written file: fall back to defaults rather than throwing
  // (which would leave the model-config page stuck on its loading state forever).
  let parsed: ProvidersConfig | null = null
  if (raw.trim()) {
    try { parsed = JSON.parse(raw) as ProvidersConfig } catch { parsed = null }
  }
  return withDefaults(parsed)
}

export async function setProvidersConfig(cfg: ProvidersConfig): Promise<void> {
  await invoke<void>('set_providers_config', { json: JSON.stringify(cfg, null, 2) })
}
