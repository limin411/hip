import { describe, it, expect } from 'vitest'
import {
  MEMORY_FILE_CONFIG_DEFAULTS,
  normalizeExtractModel,
  normalizeMemoryApiFormat,
  resolveMemoryApiFormat,
  defaultMemoryApiFormat,
  type MemoryItem,
  type MemoryCitation,
  type MemoryModelRef,
} from './memory-types.js'

describe('memory-types', () => {
  it('MEMORY_FILE_CONFIG_DEFAULTS has version 1 and flags off by default', () => {
    expect(MEMORY_FILE_CONFIG_DEFAULTS.version).toBe(1)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.useMemories).toBe(false)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.generateMemories).toBe(false)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.defaultScope).toBe('project')
  })

  it('MEMORY_FILE_CONFIG_DEFAULTS includes role-model / hybrid / trash defaults', () => {
    expect(MEMORY_FILE_CONFIG_DEFAULTS.hybridSearchEnabled).toBe(false)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.maxExtractsPerDay).toBe(20)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.trashRetentionDays).toBe(30)
    expect(MEMORY_FILE_CONFIG_DEFAULTS.embeddingModel).toBeUndefined()
    expect(MEMORY_FILE_CONFIG_DEFAULTS.rerankModel).toBeUndefined()
  })

  it('MemoryItem and MemoryCitation shapes are assignable', () => {
    const item: MemoryItem = {
      id: 'm1',
      scope: 'project',
      kind: 'preference',
      title: 'Prefer TypeScript',
      content: 'Use TS strict mode',
      confidence: 0.9,
      status: 'active',
      source: 'user',
      tags: ['lang'],
      createdAt: 1,
      updatedAt: 1,
      useCount: 0,
      pinned: false,
    }
    const cite: MemoryCitation = { memoryId: item.id, title: item.title }
    expect(cite.memoryId).toBe('m1')
  })
})

describe('normalizeExtractModel', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeExtractModel(undefined)).toBeUndefined()
    expect(normalizeExtractModel(null)).toBeUndefined()
    expect(normalizeExtractModel('')).toBeUndefined()
    expect(normalizeExtractModel('   ')).toBeUndefined()
  })

  it('parses provider/model strings', () => {
    expect(normalizeExtractModel('openai/gpt-4o-mini')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
    })
    expect(normalizeExtractModel('deepseek/deepseek-chat')).toEqual({
      providerID: 'deepseek',
      modelID: 'deepseek-chat',
    })
  })

  it('maps bare model ids to openai as last resort', () => {
    expect(normalizeExtractModel('gpt-4o-mini')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
    })
  })

  it('passes through MemoryModelRef', () => {
    const ref: MemoryModelRef = {
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    }
    expect(normalizeExtractModel(ref)).toEqual(ref)
  })

  it('preserves known apiFormat on MemoryModelRef', () => {
    expect(
      normalizeExtractModel({
        providerID: 'hip-memory-rerank',
        modelID: 'rerank-v3.5',
        baseURL: 'https://api.cohere.com/v2',
        apiFormat: 'cohere',
      }),
    ).toEqual({
      providerID: 'hip-memory-rerank',
      modelID: 'rerank-v3.5',
      baseURL: 'https://api.cohere.com/v2',
      apiFormat: 'cohere',
    })
    expect(
      normalizeExtractModel({
        providerID: 'x',
        modelID: 'm',
        apiFormat: 'not-a-format' as MemoryModelRef['apiFormat'],
      }),
    ).toEqual({ providerID: 'x', modelID: 'm' })
  })

  it('drops invalid MemoryModelRef shapes', () => {
    expect(normalizeExtractModel({ providerID: '', modelID: 'x' } as MemoryModelRef)).toBeUndefined()
    expect(normalizeExtractModel({ providerID: 'openai', modelID: '' } as MemoryModelRef)).toBeUndefined()
  })
})

describe('MemoryEndpointApiFormat helpers', () => {
  it('normalizeMemoryApiFormat keeps known values', () => {
    expect(normalizeMemoryApiFormat('openai')).toBe('openai')
    expect(normalizeMemoryApiFormat('COHERE')).toBe('cohere')
    expect(normalizeMemoryApiFormat('jina')).toBe('jina')
    expect(normalizeMemoryApiFormat('bedrock')).toBeUndefined()
    expect(normalizeMemoryApiFormat(undefined)).toBeUndefined()
  })

  it('defaults and resolves by purpose', () => {
    expect(defaultMemoryApiFormat('embedding')).toBe('openai')
    expect(defaultMemoryApiFormat('rerank')).toBe('cohere')
    expect(resolveMemoryApiFormat('embedding', { apiFormat: 'jina' })).toBe('openai')
    expect(resolveMemoryApiFormat('rerank', { apiFormat: 'jina' })).toBe('jina')
    expect(resolveMemoryApiFormat('rerank', { apiFormat: 'openai' })).toBe('cohere')
    expect(resolveMemoryApiFormat('rerank', null)).toBe('cohere')
  })
})
