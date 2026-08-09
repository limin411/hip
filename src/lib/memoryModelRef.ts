import type { MemoryModelRef } from '@hip/protocol'
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
