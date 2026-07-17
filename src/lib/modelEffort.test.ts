import { describe, it, expect } from 'vitest'
import {
  effortLevelsFromModel,
  effortLevelsForKey,
  defaultEffort,
  resolveEffort,
} from './modelEffort'
import type { Catalog, CatalogModel } from '@/ipc/catalog'

describe('effortLevelsFromModel', () => {
  it('returns null when model has no reasoning_options', () => {
    expect(effortLevelsFromModel({ id: 'm', name: 'M' })).toBeNull()
    expect(effortLevelsFromModel({ id: 'm', name: 'M', reasoning: true })).toBeNull()
    expect(effortLevelsFromModel({ id: 'm', name: 'M', reasoning_options: [] })).toBeNull()
  })

  it('returns null when only toggle/budget options exist', () => {
    const m: CatalogModel = {
      id: 'm',
      name: 'M',
      reasoning: true,
      reasoning_options: [{ type: 'toggle' }, { type: 'budget_tokens', min: 1024 }],
    }
    expect(effortLevelsFromModel(m)).toBeNull()
  })

  it('returns effort values in catalog order, de-duplicated', () => {
    const m: CatalogModel = {
      id: 'm',
      name: 'M',
      reasoning: true,
      reasoning_options: [
        { type: 'effort', values: ['low', 'medium', 'high', 'low'] },
        { type: 'toggle' },
      ],
    }
    expect(effortLevelsFromModel(m)).toEqual(['low', 'medium', 'high'])
  })

  it('merges multiple effort option blocks', () => {
    const m: CatalogModel = {
      id: 'm',
      name: 'M',
      reasoning_options: [
        { type: 'effort', values: ['low', 'medium'] },
        { type: 'effort', values: ['high', 'max'] },
      ],
    }
    expect(effortLevelsFromModel(m)).toEqual(['low', 'medium', 'high', 'max'])
  })
})

describe('effortLevelsForKey', () => {
  const catalog: Catalog = {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      env: [],
      models: {
        'gpt-5.4': {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
        },
        'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
      },
    },
  }

  it('resolves provider/model keys', () => {
    expect(effortLevelsForKey(catalog, 'openai/gpt-5.4')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('returns null for models without effort or missing keys', () => {
    expect(effortLevelsForKey(catalog, 'openai/gpt-4o')).toBeNull()
    expect(effortLevelsForKey(catalog, 'openai/missing')).toBeNull()
    expect(effortLevelsForKey(catalog, '')).toBeNull()
  })
})

describe('defaultEffort / resolveEffort', () => {
  it('prefers medium, then high, then first', () => {
    expect(defaultEffort(['low', 'medium', 'high'])).toBe('medium')
    expect(defaultEffort(['low', 'high'])).toBe('high')
    expect(defaultEffort(['xhigh', 'max'])).toBe('xhigh')
    expect(defaultEffort(['custom'])).toBe('custom')
  })

  it('keeps a valid stored value and clamps unknowns', () => {
    const levels = ['low', 'medium', 'high']
    expect(resolveEffort('high', levels)).toBe('high')
    expect(resolveEffort('xhigh', levels)).toBe('medium')
    expect(resolveEffort(undefined, levels)).toBe('medium')
    expect(resolveEffort(null, levels)).toBe('medium')
    expect(resolveEffort('high', null)).toBeNull()
    expect(resolveEffort('high', [])).toBeNull()
  })
})
