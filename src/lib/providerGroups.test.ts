import { describe, it, expect } from 'vitest'
import type { Catalog, CatalogProvider } from '@/ipc/catalog'
import { groupProviders } from './providerGroups'

const p = (over: Partial<CatalogProvider> & { id: string; name: string }): CatalogProvider => ({
  env: [], models: {}, ...over,
})

const catalog: Catalog = {
  openai: p({ id: 'openai', name: 'OpenAI', npm: '@ai-sdk/openai' }),
  groq: p({ id: 'groq', name: 'Groq' }),
  deepseek: p({ id: 'deepseek', name: 'DeepSeek' }),
  anthropic: p({ id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic' }),
  google: p({ id: 'google', name: 'Google', npm: '@ai-sdk/google' }),
  mine: p({ id: 'mine', name: 'Mine', custom: true }),
}

describe('groupProviders', () => {
  it('partitions into configured (compatible + key) / available (compatible, no key) / incompatible', () => {
    const g = groupProviders(catalog, '', { deepseek: true, mine: true })
    expect(g.configured.map((x) => x.id)).toEqual(['deepseek', 'mine'])
    expect(g.available.map((x) => x.id)).toEqual(['anthropic', 'groq', 'openai'])
    expect(g.incompatible.map((x) => x.id)).toEqual(['google'])
  })

  it('sorts each group alphabetically by name', () => {
    const g = groupProviders(catalog, '', {})
    expect(g.configured).toEqual([])
    expect(g.available.map((x) => x.name)).toEqual(['Anthropic', 'DeepSeek', 'Groq', 'Mine', 'OpenAI'])
    expect(g.incompatible.map((x) => x.name)).toEqual(['Google'])
  })

  it('filters by name substring, case-insensitive, across all groups before grouping', () => {
    expect(groupProviders(catalog, 'op', {}).available.map((x) => x.id)).toEqual(['anthropic', 'openai'])
    const g = groupProviders(catalog, 'GOOG', {})
    expect(g.incompatible.map((x) => x.id)).toEqual(['google'])
    expect(g.available).toEqual([])
    expect(g.configured).toEqual([])
  })

  it('treats custom providers as compatible (key-less custom lands in available)', () => {
    const g = groupProviders(catalog, '', {})
    expect(g.available.map((x) => x.id)).toContain('mine')
  })
})
