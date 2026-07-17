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

  it('null draft → default config + surface chat (no cwd)', () => {
    const cfg = configFromDraft(null)
    expect(cfg.surface).toBe('chat')
    expect(cfg.cwd).toBeUndefined()
    expect(cfg.llmProvider).toBe('deepseek')
  })
  it('project draft → surface code + keeps cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '' })
    expect(cfg.surface).toBe('code')
    expect(cfg.cwd).toBe('/p')
  })
  it('chat draft → surface chat, no cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '' })
    expect(cfg.surface).toBe('chat')
    expect(cfg.cwd).toBeUndefined()
  })
  it('draft without modelKey → default llmProvider', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '' })
    expect(cfg.llmProvider).toBe('deepseek')
    expect(cfg.agentId).toBeUndefined()
  })
  it('modelKey maps llmProvider + model + baseURL from catalog', () => {
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
  })
  it('never sets agentId', () => {
    expect('agentId' in configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' })).toBe(false)
  })
  it('project (code) draft carries permissionMode', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '', permissionMode: 'full' })
    expect(cfg.permissionMode).toBe('full')
  })
  it('chat draft ignores permissionMode override (sandbox, no picker)', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', permissionMode: 'full' })
    // Must not adopt draft's 'full'; DEFAULT_CONFIG may still set default mode.
    expect(cfg.permissionMode).not.toBe('full')
  })
  it('project draft carries forcePlan and clears disablePlan', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '', forcePlan: true })
    expect(cfg.forcePlan).toBe(true)
    expect(cfg.disablePlan).toBe(false)
  })
  it('chat draft ignores forcePlan', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', forcePlan: true })
    expect(cfg.forcePlan).toBeUndefined()
  })
  it('draft effort is carried into SessionConfig for chat and code', () => {
    expect(configFromDraft({ tempId: 't', mode: 'chat', text: '', effort: 'high' }).effort).toBe('high')
    expect(
      configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '', effort: 'xhigh' }).effort,
    ).toBe('xhigh')
  })
  it('draft without effort leaves effort undefined', () => {
    expect(configFromDraft({ tempId: 't', mode: 'chat', text: '' }).effort).toBeUndefined()
  })
})
