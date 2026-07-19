import { describe, it, expect } from 'vitest'
import { buildAcpSpawn } from './acp-config.js'

const baseAgent: any = { id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'], enabled: true, quirks: 'opencode' }

/** Keys hip must never inject from the active/bound model path into ACP spawn env. */
const HIP_PROVIDER_SPAWN_KEYS = [
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'HIP_MODEL_DEEPSEEK_API_KEY',
  'HIP_MODEL_ANTHROPIC_API_KEY',
  'HIP_MODEL_OPENAI_API_KEY',
] as const

describe('buildAcpSpawn (model rollback)', () => {
  it('never writes OPENCODE_CONFIG or a key, even for a legacy hip-managed agent with a model', () => {
    const model = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }
    const { command, args, env } = buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }, model)
    expect(command).toBe('opencode')
    expect(args).toEqual(['acp', '--pure'])
    expect(env.OPENCODE_CONFIG).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('does not inject DEEPSEEK/ANTHROPIC (or hip HIP_MODEL_*) keys from resolved model.apiKey', () => {
    // Self-managed: ResolvedModel may carry hip's key for internal agents, but ACP spawn
    // must not map that into provider env vars the child would pick up.
    const deepseekModel = {
      providerID: 'deepseek',
      modelID: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-hip-deepseek-must-not-leak',
    }
    const anthropicModel = {
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-20250514',
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: 'sk-hip-anthropic-must-not-leak',
    }
    const openaiModel = {
      providerID: 'openai',
      modelID: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-hip-openai-must-not-leak',
    }

    for (const model of [deepseekModel, anthropicModel, openaiModel]) {
      const { env } = buildAcpSpawn(
        {
          ...baseAgent,
          authMode: 'hip-managed',
          boundModel: { providerID: model.providerID, modelID: model.modelID },
        },
        model,
      )
      for (const key of HIP_PROVIDER_SPAWN_KEYS) {
        // Only fail if buildAcpSpawn *added* the key from the model path. Ambient process.env
        // may already contain user keys; those are inherited, not hip-active-model injection.
        if (process.env[key] === undefined) {
          expect(env[key], `must not inject ${key} from model ${model.providerID}`).toBeUndefined()
        } else {
          expect(env[key]).toBe(process.env[key])
        }
      }
      // Model secret must never appear as a newly invented env value.
      expect(Object.values(env)).not.toContain(model.apiKey)
    }
  })

  it('does not throw for a legacy hip-managed agent with no resolved model (no longer billed-default guard)', () => {
    expect(() => buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed' }, null)).not.toThrow()
  })

  it('opencode-self mode: no key, no OPENCODE_CONFIG', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self' }, null)
    expect(env.OPENCODE_CONFIG).toBeUndefined()
  })

  it('passes agent.env through to the spawn env', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', env: { MOCK_ACP_THINK: '1' } }, null)
    expect(env.MOCK_ACP_THINK).toBe('1')
  })

  it('spawns Grok Build native ACP with agent stdio and optional XAI_API_KEY env', () => {
    const grok = {
      id: 'g1',
      name: 'Grok Build',
      kind: 'acp',
      command: 'grok',
      args: ['agent', 'stdio'],
      enabled: true,
      quirks: 'grok-build',
      env: { XAI_API_KEY: 'xai-test' },
    }
    const { command, args, env } = buildAcpSpawn(grok as any, null)
    expect(command).toBe('grok')
    expect(args).toEqual(['agent', 'stdio'])
    expect(env.XAI_API_KEY).toBe('xai-test')
  })
})
