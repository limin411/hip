import type { CatalogProvider } from '@/ipc/catalog'

export interface ProviderEnablement {
  providers: Record<string, { enabled?: boolean } | undefined>
}

export interface AgentModelGroup {
  providerID: string
  providerName: string
  models: Array<{ key: string; modelID: string }>
}

/**
 * Enabled providers' models, grouped for <optgroup> pickers (agent editor, memory extract, chat).
 * When `keyConfigured` is provided, providers without a stored API key are excluded so clearing
 * a key removes them from pickers (enabled alone is not enough).
 */
export function groupModelOptions(
  catalog: Record<string, CatalogProvider>,
  config: ProviderEnablement,
  keyConfigured?: Record<string, boolean>,
): AgentModelGroup[] {
  return Object.entries(catalog)
    .filter(([id]) => {
      if (!config.providers[id]?.enabled) return false
      if (keyConfigured !== undefined && !keyConfigured[id]) return false
      return true
    })
    .map(([id, p]) => ({
      providerID: id,
      providerName: p.name,
      models: Object.keys(p.models ?? {}).map((m) => ({ key: `${id}/${m}`, modelID: m })),
    }))
    .filter((g) => g.models.length > 0)
}
