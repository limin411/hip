import { describe, it, expect, beforeEach } from 'vitest'
import { configFromDraft } from './sessionService'
import { useProvidersStore } from '@/store/providersStore'

describe('configFromDraft', () => {
  beforeEach(() => {
    // Seed the providers store so configFromDraft can resolve modelKey → SessionConfig fields.
    useProvidersStore.setState({
      catalog: {
        openai: { id: 'openai', name: 'OpenAI', env: [], api: 'https://api.openai.com/v1', models: {} },
      },
      config: {
        providers: { openai: { enabled: true } },
        activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
      },
    })
  })

  it('null draft → default config', () => {
    const cfg = configFromDraft(null)
    expect(cfg.agentId).toBeUndefined()
    expect(cfg.llmProvider).toBe('deepseek')
  })
  it('project draft keeps cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '' })
    expect(cfg.cwd).toBe('/p')
  })
  it('draft without modelKey → default llmProvider', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '' })
    expect(cfg.llmProvider).toBe('deepseek')
    expect(cfg.agentId).toBeUndefined()
  })
  it('draft with modelKey maps llmProvider + model + baseURL from catalog', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' })
    expect(cfg.llmProvider).toBe('openai')
    expect(cfg.model).toBe('gpt-4o')
    expect(cfg.baseURL).toBe('https://api.openai.com/v1')
  })
  it('draft with modelKey and a provider baseURL override prefers the config baseURL', () => {
    useProvidersStore.setState({
      catalog: {
        openai: { id: 'openai', name: 'OpenAI', env: [], api: 'https://api.openai.com/v1', models: {} },
      },
      config: {
        providers: { openai: { enabled: true, baseURL: 'https://my-proxy.example.com/v1' } },
        activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
      },
    })
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' })
    expect(cfg.baseURL).toBe('https://my-proxy.example.com/v1')
  })
  it('project draft with modelKey keeps cwd and resolves model', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/work', text: '', modelKey: 'openai/gpt-4o' })
    expect(cfg.cwd).toBe('/work')
    expect(cfg.llmProvider).toBe('openai')
    expect(cfg.model).toBe('gpt-4o')
  })
})
