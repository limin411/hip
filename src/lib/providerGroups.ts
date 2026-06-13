import { isCompatible, type Catalog, type CatalogProvider } from '@/ipc/catalog'

export interface ProviderGroups {
  /** Compatible providers with a stored API key. */
  configured: CatalogProvider[]
  /** Compatible providers without a stored key yet. */
  available: CatalogProvider[]
  /** Providers with no OpenAI-compatible API — not selectable. */
  incompatible: CatalogProvider[]
}

/**
 * Partition the catalog into the three buckets the model-config list renders, after
 * applying the case-insensitive name filter. Each bucket is sorted by name.
 */
export function groupProviders(
  catalog: Catalog,
  filter: string,
  keyConfigured: Record<string, boolean>,
): ProviderGroups {
  const q = filter.trim().toLowerCase()
  const groups: ProviderGroups = { configured: [], available: [], incompatible: [] }
  for (const p of Object.values(catalog)) {
    if (q && !p.name.toLowerCase().includes(q)) continue
    if (!isCompatible(p)) groups.incompatible.push(p)
    else if (keyConfigured[p.id]) groups.configured.push(p)
    else groups.available.push(p)
  }
  const byName = (a: CatalogProvider, b: CatalogProvider) => a.name.localeCompare(b.name)
  groups.configured.sort(byName)
  groups.available.sort(byName)
  groups.incompatible.sort(byName)
  return groups
}
