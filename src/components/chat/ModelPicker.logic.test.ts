import { describe, it, expect } from 'vitest'
import { modelPickerItems, currentModelLabel, committedModelId } from './ModelPicker.js'

const catalog = { openai: { id: 'openai', name: 'OpenAI', env: [], api: 'x', models: { 'gpt-4o': {} } } } as any
const config = { providers: { openai: { enabled: true } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } } as any

describe('ModelPicker logic', () => {
  it('lists enabled providers/models as groups', () => {
    expect(modelPickerItems(catalog, config)[0]).toMatchObject({ providerID: 'openai', models: [{ key: 'openai/gpt-4o', modelID: 'gpt-4o' }] })
  })
  it('labels the current draft model by its modelID', () => {
    expect(currentModelLabel('openai/gpt-4o')).toBe('gpt-4o')
  })
})

describe('committedModelId (locked chip)', () => {
  it('shows the pinned model when the session has one', () => {
    expect(committedModelId('gpt-4o', config)).toBe('gpt-4o')
  })
  it('falls back to the global active model when the session model is empty (mirrors the server)', () => {
    expect(committedModelId('', config)).toBe('gpt-4o')
  })
  it('returns empty when neither a session model nor an active model exists', () => {
    const noActive = { providers: {}, activeModel: undefined } as any
    expect(committedModelId('', noActive)).toBe('')
  })
})
