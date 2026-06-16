import type { Catalog } from '@/ipc/catalog'
import type { ProvidersConfig } from '@hip/protocol'

/** Split a 'providerID/modelID' key — modelID may itself contain '/'. */
export function parseModelKey(key: string): { providerID: string; modelID: string } {
  const slash = key.indexOf('/')
  if (slash < 0) return { providerID: key, modelID: '' } // malformed/no-slash: don't silently corrupt
  return { providerID: key.slice(0, slash), modelID: key.slice(slash + 1) }
}

function resolveBaseURL(catalog: Catalog, config: ProvidersConfig, providerID: string): string {
  return config.providers[providerID]?.baseURL ?? catalog[providerID]?.api ?? ''
}

/** Resolve a model key to the SessionConfig LLM fields. */
export function resolveModelConfig(
  catalog: Catalog,
  config: ProvidersConfig,
  key: string,
): { llmProvider: string; model: string; baseURL: string } {
  const { providerID, modelID } = parseModelKey(key)
  return { llmProvider: providerID, model: modelID, baseURL: resolveBaseURL(catalog, config, providerID) }
}

/** The key for the global active model, or '' if none set. */
export function activeModelKey(config: ProvidersConfig): string {
  const a = config.activeModel
  return a ? `${a.providerID}/${a.modelID}` : ''
}
