import { describe, it, expect, beforeEach } from 'vitest'
import { configFromDraft } from './sessionService'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import type { AgentConfig } from '@hip/protocol'

const acpAgent = (id: string, overrides?: Partial<AgentConfig>): AgentConfig => ({
  id,
  name: id,
  kind: 'acp',
  command: 'cmd',
  args: [],
  enabled: true,
  ...overrides,
})

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
    useHipConfigStore.setState({
      config: {
        version: 1,
        agents: [
          acpAgent('acp-opencode'),
          acpAgent('acp-grok'),
          acpAgent('legacy-oc', { kind: 'opencode' }),
          acpAgent('disabled-acp', { enabled: false }),
          acpAgent('internal-coder', { kind: 'internal', command: '', prompt: 'x' }),
        ],
      },
      loaded: true,
      error: null,
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
  it('does not set agentId for builtin / empty / whitespace draft agent', () => {
    expect(
      'agentId' in configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' }),
    ).toBe(false)
    expect(
      'agentId' in
        configFromDraft({
          tempId: 't',
          mode: 'chat',
          text: '',
          modelKey: 'openai/gpt-4o',
          agentId: 'builtin',
        }),
    ).toBe(false)
    expect(
      'agentId' in
        configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o', agentId: '' }),
    ).toBe(false)
    expect(
      'agentId' in
        configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o', agentId: '  ' }),
    ).toBe(false)
  })
  it('sets agentId when draft selects an enabled ACP agent', () => {
    const cfg = configFromDraft({
      tempId: 't',
      mode: 'chat',
      text: '',
      modelKey: 'openai/gpt-4o',
      agentId: 'acp-opencode',
    })
    expect(cfg.agentId).toBe('acp-opencode')
  })
  it('sets agentId for legacy kind opencode', () => {
    expect(
      configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'legacy-oc' }).agentId,
    ).toBe('legacy-oc')
  })
  it('omits agentId when agent is missing, disabled, or not ACP-capable', () => {
    expect(
      'agentId' in configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'gone' }),
    ).toBe(false)
    expect(
      'agentId' in configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'disabled-acp' }),
    ).toBe(false)
    expect(
      'agentId' in configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'internal-coder' }),
    ).toBe(false)
  })
  it('carries external agentId on project drafts too', () => {
    const cfg = configFromDraft({
      tempId: 't',
      mode: 'project',
      cwd: '/p',
      text: '',
      agentId: 'acp-grok',
    })
    expect(cfg.agentId).toBe('acp-grok')
    expect(cfg.surface).toBe('code')
  })
  it('skips forcePlan and hip model/effort when ACP primary', () => {
    const cfg = configFromDraft({
      tempId: 't',
      mode: 'project',
      cwd: '/p',
      text: '',
      agentId: 'acp-grok',
      forcePlan: true,
      modelKey: 'openai/gpt-4o',
      effort: 'high',
    })
    expect(cfg.agentId).toBe('acp-grok')
    expect(cfg.forcePlan).toBeUndefined()
    expect(cfg.effort).toBeUndefined()
    // modelKey resolution skipped for ACP primary — keep DEFAULT_CONFIG provider
    expect(cfg.llmProvider).toBe('deepseek')
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
    expect(cfg.executionMode).toBe('plan')
  })
  it('project draft carries autopilot when full', () => {
    const cfg = configFromDraft({
      tempId: 't',
      mode: 'project',
      cwd: '/p',
      text: '',
      permissionMode: 'full',
      executionMode: 'autopilot',
    })
    expect(cfg.executionMode).toBe('autopilot')
    expect(cfg.forcePlan).toBe(false)
    expect(cfg.permissionMode).toBe('full')
  })
  it('chat draft ignores forcePlan', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', forcePlan: true })
    expect(cfg.forcePlan).toBeUndefined()
    expect(cfg.executionMode).toBeUndefined()
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
  it('drops draft effort when the resolved model is known without effort options', () => {
    useProvidersStore.setState({
      catalog: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          api: 'https://api.openai.com/v1',
          models: {
            'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
          },
        },
      },
      config: {
        providers: { openai: { enabled: true } },
        activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
      },
    })
    expect(
      configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o', effort: 'max' }).effort,
    ).toBeUndefined()
  })
  it('clamps draft effort invalid for the target model', () => {
    useProvidersStore.setState({
      catalog: {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          api: 'https://api.openai.com/v1',
          models: {
            'gpt-5.4': {
              id: 'gpt-5.4',
              name: 'GPT-5.4',
              reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
            },
          },
        },
      },
      config: {
        providers: { openai: { enabled: true } },
        activeModel: { providerID: 'openai', modelID: 'gpt-5.4' },
      },
    })
    expect(
      configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-5.4', effort: 'max' }).effort,
    ).toBe('medium')
  })
})
