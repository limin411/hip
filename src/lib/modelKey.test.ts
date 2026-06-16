import { describe, it, expect } from 'vitest'
import { parseModelKey, resolveModelConfig, activeModelKey } from './modelKey.js'

const catalog = { openai: { id: 'openai', name: 'OpenAI', env: [], api: 'https://api.openai.com/v1', models: { 'gpt-4o': {} } } } as any
const config = { providers: { openai: { enabled: true } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } } as any

describe('modelKey helpers', () => {
  it('parses provider/model', () => {
    expect(parseModelKey('openai/gpt-4o')).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
  })
  it('parses model ids that contain slashes', () => {
    expect(parseModelKey('openrouter/anthropic/claude')).toEqual({ providerID: 'openrouter', modelID: 'anthropic/claude' })
  })
  it('does not corrupt a no-slash key', () => {
    expect(parseModelKey('weird')).toEqual({ providerID: 'weird', modelID: '' })
  })
  it('resolves a model key to SessionConfig fields with baseURL', () => {
    expect(resolveModelConfig(catalog, config, 'openai/gpt-4o')).toEqual({ llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })
  it('derives the active model key from config', () => {
    expect(activeModelKey(config)).toBe('openai/gpt-4o')
  })
})
