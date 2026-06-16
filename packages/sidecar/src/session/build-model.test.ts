import { describe, it, expect } from 'vitest'
import { resolveModelChoice } from './session.js' // pure helper extracted from buildModel

describe('resolveModelChoice', () => {
  const fallback = { providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com/v1' }
  it('uses the session config model when present', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', tools: [] }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })
  it('falls back to the global active model when config.model is empty', () => {
    const c = resolveModelChoice({ llmProvider: 'deepseek', model: '', tools: [] }, fallback)
    expect(c).toEqual(fallback)
  })
  it('falls back to active baseURL when config.baseURL is missing', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o', tools: [] }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.deepseek.com/v1' })
  })
})
