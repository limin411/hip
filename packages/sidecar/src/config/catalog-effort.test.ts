import { describe, it, expect } from 'vitest'
import { clampEffortAgainstModel, effortLevelsFromCatalogModel, type CatalogModel } from './catalog.js'

describe('effortLevelsFromCatalogModel', () => {
  it('returns null when missing or without effort options', () => {
    expect(effortLevelsFromCatalogModel(undefined)).toBeNull()
    expect(effortLevelsFromCatalogModel({ id: 'm', name: 'M' })).toBeNull()
    expect(
      effortLevelsFromCatalogModel({
        id: 'm',
        name: 'M',
        reasoning_options: [{ type: 'toggle' }],
      }),
    ).toBeNull()
  })

  it('returns effort values', () => {
    const m: CatalogModel = {
      id: 'm',
      name: 'M',
      reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
    }
    expect(effortLevelsFromCatalogModel(m)).toEqual(['low', 'high'])
  })
})

describe('clampEffortAgainstModel (cross-model isolation)', () => {
  const openai: CatalogModel = {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
  }
  const plain: CatalogModel = { id: 'gpt-4o', name: 'GPT-4o' }
  const anthropic: CatalogModel = {
    id: 'claude-opus-4-8',
    name: 'Opus',
    reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
  }

  it('passes through when model is unknown', () => {
    expect(clampEffortAgainstModel(undefined, 'max')).toBe('max')
  })

  it('drops effort for models that do not advertise effort', () => {
    expect(clampEffortAgainstModel(plain, 'high')).toBeUndefined()
    expect(clampEffortAgainstModel(plain, 'max')).toBeUndefined()
  })

  it('keeps only values listed for the model', () => {
    expect(clampEffortAgainstModel(openai, 'high')).toBe('high')
    expect(clampEffortAgainstModel(openai, 'max')).toBeUndefined()
    expect(clampEffortAgainstModel(anthropic, 'max')).toBe('max')
    expect(clampEffortAgainstModel(anthropic, 'none')).toBeUndefined()
  })
})
