import { describe, it, expect, vi } from 'vitest'
import { withDefaults, getProvidersConfig } from './providersConfig'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

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

describe('getProvidersConfig self-heal', () => {
  it('falls back to defaults when the stored file is corrupt JSON', async () => {
    invokeMock.mockResolvedValueOnce('{ this is not valid json')
    const cfg = await getProvidersConfig()
    expect(cfg.providers.deepseek.enabled).toBe(true)
    expect(cfg.activeModel).toEqual({ providerID: 'deepseek', modelID: 'deepseek-reasoner' })
  })
})
