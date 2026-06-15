import { describe, it, expect } from 'vitest'
import type { CatalogProvider } from '@/ipc/catalog'
import { groupModelOptions } from './agentModelOptions'

const provider = (name: string, models: string[]): CatalogProvider =>
  ({ name, models: Object.fromEntries(models.map((m) => [m, { id: m, name: m }])) } as unknown as CatalogProvider)

const catalog = {
  anthropic: provider('Anthropic', ['claude-opus-4', 'claude-sonnet-4']),
  openai: provider('OpenAI', ['gpt-5']),
  empty: provider('Empty', []),
}

describe('groupModelOptions', () => {
  it('includes only enabled providers, grouped, keyed providerID/modelID', () => {
    const groups = groupModelOptions(catalog, { providers: { anthropic: { enabled: true } } })
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ providerID: 'anthropic', providerName: 'Anthropic' })
    expect(groups[0].models).toEqual([
      { key: 'anthropic/claude-opus-4', modelID: 'claude-opus-4' },
      { key: 'anthropic/claude-sonnet-4', modelID: 'claude-sonnet-4' },
    ])
  })

  it('drops disabled and model-less providers', () => {
    const groups = groupModelOptions(catalog, {
      providers: { anthropic: { enabled: true }, openai: { enabled: false }, empty: { enabled: true } },
    })
    expect(groups.map((g) => g.providerID)).toEqual(['anthropic'])
  })
})
