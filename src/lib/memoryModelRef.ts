import type { MemoryModelRef } from '@hip/protocol'
import type { Catalog } from '@/ipc/catalog'
import { parseModelKey } from '@/lib/modelKey'

/** Stable select value for a role-model ref or legacy string. */
export function memoryModelKey(v: string | MemoryModelRef | undefined | null): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string') {
    const raw = v.trim()
    if (!raw) return ''
    // Bare ids cannot map to catalog keys; keep as-is so UI can show empty selection.
    return raw.includes('/') ? raw : raw
  }
  return `${v.providerID}/${v.modelID}`
}

/** Build MemoryModelRef from a `provider/model` select key. Empty → undefined (clear). */
export function memoryModelRefFromKey(
  key: string,
  baseURL?: string,
): MemoryModelRef | undefined {
  const raw = key.trim()
  if (!raw) return undefined
  const { providerID, modelID } = parseModelKey(raw)
  if (!providerID || !modelID) return undefined
  return baseURL ? { providerID, modelID, baseURL } : { providerID, modelID }
}

/**
 * Whether the active chat provider can use the one-click embedding recommendation
 * (`text-embedding-3-small` on that provider).
 */
export function canRecommendEmbedding(providerID: string, catalog: Catalog): boolean {
  if (providerID === 'openai') return true
  const p = catalog[providerID]
  if (!p) return false
  if (p.custom) return true
  if (p.npm === '@ai-sdk/openai' || p.npm === '@ai-sdk/openai-compatible') return true
  return false
}

export const RECOMMENDED_EMBEDDING_MODEL_ID = 'text-embedding-3-small'
