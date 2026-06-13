import { describe, it, expect } from 'vitest'
import type { CatalogModel } from '@/ipc/catalog'
import { filterModels, NO_CAPS } from './modelFilter'

const m = (over: Partial<CatalogModel> & { id: string; name: string }): CatalogModel => ({ ...over })

const models: CatalogModel[] = [
  m({ id: 'gpt-4o', name: 'GPT-4o', tool_call: true, attachment: true }),
  m({ id: 'o3', name: 'o3', reasoning: true, tool_call: true }),
  m({ id: 'gpt-4o-mini', name: 'GPT-4o mini', tool_call: true, attachment: true }),
  m({ id: 'o4-mini', name: 'o4-mini', reasoning: true }),
]

describe('filterModels', () => {
  it('returns every model sorted by name when no filters are active', () => {
    expect(filterModels(models, '', NO_CAPS).map((x) => x.id)).toEqual(['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'])
  })

  it('filters by name OR id substring, case-insensitive', () => {
    expect(filterModels(models, 'MINI', NO_CAPS).map((x) => x.id)).toEqual(['gpt-4o-mini', 'o4-mini'])
    expect(filterModels(models, 'o3', NO_CAPS).map((x) => x.id)).toEqual(['o3'])
  })

  it('narrows by a single capability', () => {
    expect(filterModels(models, '', { ...NO_CAPS, reasoning: true }).map((x) => x.id)).toEqual(['o3', 'o4-mini'])
    expect(filterModels(models, '', { ...NO_CAPS, attachment: true }).map((x) => x.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('ANDs multiple active capabilities together', () => {
    expect(filterModels(models, '', { reasoning: true, tool_call: true, attachment: false }).map((x) => x.id)).toEqual(['o3'])
  })

  it('combines search and capability filters', () => {
    expect(filterModels(models, 'gpt', { ...NO_CAPS, attachment: true }).map((x) => x.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })
})
