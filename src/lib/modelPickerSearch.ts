import type { AgentModelGroup } from '@/lib/agentModelOptions'
import { parseModelKey } from '@/lib/modelKey'

/** Pure: label for a model key. */
export function currentModelLabel(key: string): string {
  return key ? parseModelKey(key).modelID : ''
}

/** Pure: total model count across groups. */
export function countModels(groups: AgentModelGroup[]): number {
  return groups.reduce((n, g) => n + g.models.length, 0)
}

/**
 * Pure: filter provider groups by a case-insensitive query matching model id,
 * provider name/id, or full key. Empty query returns groups unchanged.
 */
export function filterModelGroups(
  groups: AgentModelGroup[],
  query: string,
): AgentModelGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({
      ...g,
      models: g.models.filter(
        (m) =>
          m.modelID.toLowerCase().includes(q) ||
          m.key.toLowerCase().includes(q) ||
          g.providerName.toLowerCase().includes(q) ||
          g.providerID.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.models.length > 0)
}

/** Flat list used for keyboard highlight navigation. */
export function flattenModelKeys(groups: AgentModelGroup[]): string[] {
  return groups.flatMap((g) => g.models.map((m) => m.key))
}

/** Show the search field once the catalog is large enough to scroll. */
export const MODEL_SEARCH_THRESHOLD = 8
