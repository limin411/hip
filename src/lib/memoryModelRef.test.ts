import { describe, it, expect } from 'vitest'
import {
  canRecommendEmbedding,
  memoryModelKey,
  memoryModelRefFromKey,
  RECOMMENDED_EMBEDDING_MODEL_ID,
} from './memoryModelRef.js'

describe('memoryModelKey', () => {
  it('formats ref and string keys', () => {
    expect(memoryModelKey(undefined)).toBe('')
    expect(memoryModelKey('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini')
    expect(memoryModelKey({ providerID: 'openai', modelID: 'gpt-4o-mini' })).toBe('openai/gpt-4o-mini')
  })
})

describe('memoryModelRefFromKey', () => {
  it('builds ref and clears empty', () => {
    expect(memoryModelRefFromKey('')).toBeUndefined()
    expect(memoryModelRefFromKey('openai/gpt-4o-mini')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
    })
    expect(memoryModelRefFromKey('openai/gpt-4o-mini', 'https://api.openai.com/v1')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    })
  })
})

describe('canRecommendEmbedding', () => {
  it('allows openai and openai-compatible npm / custom', () => {
    expect(canRecommendEmbedding('openai', {})).toBe(true)
    expect(
      canRecommendEmbedding('x', {
        x: { id: 'x', name: 'X', env: [], npm: '@ai-sdk/openai-compatible', models: {} },
      }),
    ).toBe(true)
    expect(
      canRecommendEmbedding('mine', {
        mine: { id: 'mine', name: 'Mine', env: [], custom: true, models: {} },
      }),
    ).toBe(true)
    expect(
      canRecommendEmbedding('anthropic', {
        anthropic: { id: 'anthropic', name: 'Anthropic', env: [], npm: '@ai-sdk/anthropic', models: {} },
      }),
    ).toBe(false)
  })

  it('recommended model id is text-embedding-3-small', () => {
    expect(RECOMMENDED_EMBEDDING_MODEL_ID).toBe('text-embedding-3-small')
  })
})
