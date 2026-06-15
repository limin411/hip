import type { CatalogModel } from '@/ipc/catalog'

export type ModelCapKey = 'reasoning' | 'tool_call' | 'attachment'

export interface ModelBadges {
  /** Context window in thousands (rounded), or null when the model omits a limit. */
  contextK: number | null
  /** Capability flags present on the model, in a stable display order. */
  caps: ModelCapKey[]
}

const CAP_ORDER: ModelCapKey[] = ['reasoning', 'tool_call', 'attachment']

export function modelBadges(m: CatalogModel): ModelBadges {
  return {
    contextK: m.limit?.context ? Math.round(m.limit.context / 1000) : null,
    caps: CAP_ORDER.filter((k) => m[k]),
  }
}
