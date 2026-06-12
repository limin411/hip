import { describe, it, expect } from 'vitest'
import { withDefaults } from './providersConfig'

describe('withDefaults', () => {
  it('seeds deepseek + active model from an empty config', () => {
    const cfg = withDefaults(null)
    expect(cfg.providers.deepseek.enabled).toBe(true)
    expect(cfg.providers.deepseek.baseURL).toBe('https://api.deepseek.com/v1')
    expect(cfg.activeModel).toEqual({ providerID: 'deepseek', modelID: 'deepseek-reasoner' })
  })
  it('preserves an existing config', () => {
    const existing = { providers: { openai: { enabled: true, baseURL: 'u' } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } }
    expect(withDefaults(existing)).toEqual(existing)
  })
})
