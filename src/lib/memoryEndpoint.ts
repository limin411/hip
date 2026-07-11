import type { MemoryEndpointApiFormat, MemoryModelRef } from '@hip/protocol'
import { defaultMemoryApiFormat, resolveMemoryApiFormat } from '@hip/protocol'

/** Virtual provider id for memory embedding credentials (independent of chat providers). */
export const MEMORY_EMBEDDING_PROVIDER_ID = 'hip-memory-embedding'

/** Virtual provider id for memory rerank credentials (independent of chat providers). */
export const MEMORY_RERANK_PROVIDER_ID = 'hip-memory-rerank'

export type MemoryEndpointPurpose = 'embedding' | 'rerank'

export type RerankApiFormat = Extract<MemoryEndpointApiFormat, 'cohere' | 'jina'>

export function memoryEndpointProviderId(purpose: MemoryEndpointPurpose): string {
  return purpose === 'embedding' ? MEMORY_EMBEDDING_PROVIDER_ID : MEMORY_RERANK_PROVIDER_ID
}

/** Build MemoryModelRef bound to the dedicated virtual provider for this purpose. */
export function buildMemoryEndpointRef(
  purpose: MemoryEndpointPurpose,
  baseURL: string,
  modelID: string,
  apiFormat?: MemoryEndpointApiFormat,
): MemoryModelRef | undefined {
  const url = baseURL.trim().replace(/\/$/, '')
  const model = modelID.trim()
  if (!url || !model) return undefined
  const format = resolveMemoryApiFormat(purpose, {
    apiFormat: apiFormat ?? defaultMemoryApiFormat(purpose),
  })
  return {
    providerID: memoryEndpointProviderId(purpose),
    modelID: model,
    baseURL: url,
    apiFormat: format,
  }
}

/** Secret lookup id for an existing ref: virtual slot if already migrated, else legacy providerID. */
export function memoryEndpointKeyProviderId(
  purpose: MemoryEndpointPurpose,
  ref: MemoryModelRef | undefined | null,
): string {
  if (ref?.providerID) return ref.providerID
  return memoryEndpointProviderId(purpose)
}

export { resolveMemoryApiFormat, defaultMemoryApiFormat }
