import type { Catalog, CatalogModel, ReasoningOption } from '@/ipc/catalog'
import { parseModelKey } from '@/lib/modelKey'

/** Preferred defaults when the model offers several effort levels. */
const PREFERRED_DEFAULTS = ['medium', 'high', 'low', 'minimal', 'xhigh', 'max', 'none'] as const

/** Extract effort value list from a catalog model, or null when the model has no effort control. */
export function effortLevelsFromModel(model: CatalogModel | undefined | null): string[] | null {
  if (!model?.reasoning_options?.length) return null
  const values: string[] = []
  for (const opt of model.reasoning_options as ReasoningOption[]) {
    if (opt?.type !== 'effort') continue
    if (!Array.isArray(opt.values)) continue
    for (const v of opt.values) {
      if (typeof v === 'string' && v.trim() && !values.includes(v)) values.push(v)
    }
  }
  return values.length > 0 ? values : null
}

/** Resolve effort levels for a `providerID/modelID` key from the catalog. */
export function effortLevelsForKey(catalog: Catalog, modelKey: string): string[] | null {
  if (!modelKey) return null
  const { providerID, modelID } = parseModelKey(modelKey)
  if (!providerID || !modelID) return null
  return effortLevelsFromModel(catalog[providerID]?.models?.[modelID])
}

/** Pick a default effort from an allowed list (medium preferred). */
export function defaultEffort(levels: readonly string[]): string {
  if (levels.length === 0) return 'medium'
  for (const pref of PREFERRED_DEFAULTS) {
    if (levels.includes(pref)) return pref
  }
  return levels[0]!
}

/**
 * Clamp a stored/draft effort to the current model's allowed list.
 * undefined / empty / unknown → default for that list.
 */
export function resolveEffort(
  effort: string | undefined | null,
  levels: readonly string[] | null | undefined,
): string | null {
  if (!levels || levels.length === 0) return null
  if (effort && levels.includes(effort)) return effort
  return defaultEffort(levels)
}
