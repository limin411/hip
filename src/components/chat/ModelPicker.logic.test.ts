import { describe, it, expect } from 'vitest'
import type { AgentModelGroup } from '@/lib/agentModelOptions'
import {
  modelPickerItems,
  currentModelLabel,
  filterModelGroups,
  flattenModelKeys,
  countModels,
  MODEL_SEARCH_THRESHOLD,
} from './ModelPicker.js'

const catalog = {
  openai: { id: 'openai', name: 'OpenAI', env: [], api: 'x', models: { 'gpt-4o': {} } },
} as any
const config = {
  providers: { openai: { enabled: true } },
  activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
} as any

const groups: AgentModelGroup[] = [
  {
    providerID: 'openai',
    providerName: 'OpenAI',
    models: [
      { key: 'openai/gpt-4o', modelID: 'gpt-4o' },
      { key: 'openai/gpt-4o-mini', modelID: 'gpt-4o-mini' },
    ],
  },
  {
    providerID: 'anthropic',
    providerName: 'Anthropic',
    models: [{ key: 'anthropic/claude-sonnet-4', modelID: 'claude-sonnet-4' }],
  },
]

describe('ModelPicker logic', () => {
  it('lists enabled providers/models as groups', () => {
    expect(modelPickerItems(catalog, config)[0]).toMatchObject({
      providerID: 'openai',
      models: [{ key: 'openai/gpt-4o', modelID: 'gpt-4o' }],
    })
  })

  it('labels the current draft model by its modelID', () => {
    expect(currentModelLabel('openai/gpt-4o')).toBe('gpt-4o')
  })

  it('counts models across groups', () => {
    expect(countModels(groups)).toBe(3)
    expect(countModels([])).toBe(0)
  })

  it('flattens keys in group order', () => {
    expect(flattenModelKeys(groups)).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
    ])
  })

  it('returns all groups when query is empty', () => {
    expect(filterModelGroups(groups, '  ')).toEqual(groups)
  })

  it('filters by model id substring (case-insensitive)', () => {
    const filtered = filterModelGroups(groups, 'MINI')
    expect(filtered).toEqual([
      {
        providerID: 'openai',
        providerName: 'OpenAI',
        models: [{ key: 'openai/gpt-4o-mini', modelID: 'gpt-4o-mini' }],
      },
    ])
  })

  it('filters by provider name and drops empty groups', () => {
    const filtered = filterModelGroups(groups, 'anthropic')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.providerID).toBe('anthropic')
    expect(filtered[0]?.models).toHaveLength(1)
  })

  it('returns empty when nothing matches', () => {
    expect(filterModelGroups(groups, 'zzz-nope')).toEqual([])
  })

  it('exposes a search threshold above short catalogs', () => {
    expect(MODEL_SEARCH_THRESHOLD).toBeGreaterThan(1)
  })
})
