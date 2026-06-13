import type { CatalogModel } from '@/ipc/catalog'

/** The three capability toggles the model list can filter by. Each maps to a CatalogModel flag. */
export interface ModelCaps {
  reasoning: boolean
  tool_call: boolean
  attachment: boolean
}

export const NO_CAPS: ModelCaps = { reasoning: false, tool_call: false, attachment: false }

/**
 * Filter a provider's models by a case-insensitive name/id search and by capability toggles
 * (each active toggle further narrows — AND), then sort by name. Pure; the active-model pin
 * is handled by the caller.
 */
export function filterModels(models: CatalogModel[], query: string, caps: ModelCaps): CatalogModel[] {
  const q = query.trim().toLowerCase()
  return models
    .filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.id.toLowerCase().includes(q)) return false
      if (caps.reasoning && !m.reasoning) return false
      if (caps.tool_call && !m.tool_call) return false
      if (caps.attachment && !m.attachment) return false
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
