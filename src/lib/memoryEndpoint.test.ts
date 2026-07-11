import { describe, it, expect } from 'vitest'
import {
  MEMORY_EMBEDDING_PROVIDER_ID,
  MEMORY_RERANK_PROVIDER_ID,
  buildMemoryEndpointRef,
  memoryEndpointKeyProviderId,
  memoryEndpointProviderId,
} from './memoryEndpoint'

describe('memoryEndpoint', () => {
  it('maps purpose to virtual provider ids', () => {
    expect(memoryEndpointProviderId('embedding')).toBe(MEMORY_EMBEDDING_PROVIDER_ID)
    expect(memoryEndpointProviderId('rerank')).toBe(MEMORY_RERANK_PROVIDER_ID)
  })

  it('builds ref with trimmed baseURL and modelID', () => {
    expect(buildMemoryEndpointRef('embedding', ' https://api.openai.com/v1/ ', ' text-embedding-3-small ')).toEqual({
      providerID: MEMORY_EMBEDDING_PROVIDER_ID,
      modelID: 'text-embedding-3-small',
      baseURL: 'https://api.openai.com/v1',
    })
  })

  it('returns undefined when baseURL or modelID empty', () => {
    expect(buildMemoryEndpointRef('rerank', '', 'm')).toBeUndefined()
    expect(buildMemoryEndpointRef('rerank', 'https://x', '  ')).toBeUndefined()
  })

  it('key provider id prefers existing ref then virtual slot', () => {
    expect(memoryEndpointKeyProviderId('embedding', null)).toBe(MEMORY_EMBEDDING_PROVIDER_ID)
    expect(
      memoryEndpointKeyProviderId('embedding', {
        providerID: 'openai',
        modelID: 'text-embedding-3-small',
      }),
    ).toBe('openai')
    expect(
      memoryEndpointKeyProviderId('embedding', {
        providerID: MEMORY_EMBEDDING_PROVIDER_ID,
        modelID: 'm',
        baseURL: 'https://x',
      }),
    ).toBe(MEMORY_EMBEDDING_PROVIDER_ID)
  })
})
