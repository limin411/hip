import { describe, it, expect } from 'vitest'
import { resolveModelChoice } from './session.js'

describe('resolveModelChoice with profileBinding', () => {
  const fallback = { providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com/v1' }

  it('overrides providerID and modelID from profileBinding when present', () => {
    const c = resolveModelChoice(
      { llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' },
      fallback,
      { providerID: 'custom', modelID: 'custom-model' },
    )
    expect(c).toEqual({ providerID: 'custom', modelID: 'custom-model', baseURL: 'https://api.openai.com/v1' })
  })

  it('falls back baseURL to fallback when config.baseURL is empty and profileBinding is present', () => {
    const c = resolveModelChoice(
      { llmProvider: '', model: '' },
      fallback,
      { providerID: 'custom', modelID: 'custom-model' },
    )
    expect(c).toEqual({ providerID: 'custom', modelID: 'custom-model', baseURL: 'https://api.deepseek.com/v1' })
  })

  it('uses config.baseURL when profileBinding is present and config.baseURL is set', () => {
    const c = resolveModelChoice(
      { llmProvider: '', model: '', baseURL: 'https://custom.api.com' },
      fallback,
      { providerID: 'anthropic', modelID: 'claude-3' },
    )
    expect(c).toEqual({ providerID: 'anthropic', modelID: 'claude-3', baseURL: 'https://custom.api.com' })
  })

  it('still works without profileBinding (uses config model)', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })

  it('still falls back without profileBinding when config.model is empty', () => {
    const c = resolveModelChoice({ llmProvider: 'deepseek', model: '' }, fallback)
    expect(c).toEqual(fallback)
  })
})
