import type { CatalogProvider } from '@/ipc/catalog'

export interface ProviderEnablement {
  providers: Record<string, { enabled?: boolean } | undefined>
}

export interface AgentModelGroup {
  providerID: string
  providerName: string
  models: Array<{ key: string; modelID: string }>
}

/** Enabled providers' models, grouped for the agent editor's <optgroup> picker. */
export function groupModelOptions(
  catalog: Record<string, CatalogProvider>,
  config: ProviderEnablement,
): AgentModelGroup[] {
  return Object.entries(catalog)
    .filter(([id]) => config.providers[id]?.enabled)
    .map(([id, p]) => ({
      providerID: id,
      providerName: p.name,
      models: Object.keys(p.models ?? {}).map((m) => ({ key: `${id}/${m}`, modelID: m })),
    }))
    .filter((g) => g.models.length > 0)
}
