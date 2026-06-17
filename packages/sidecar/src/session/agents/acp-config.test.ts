import { describe, it, expect } from 'vitest'
import { buildAcpSpawn } from './acp-config.js'

const baseAgent: any = { id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'], transport: 'rich', enabled: true, quirks: 'opencode' }

describe('buildAcpSpawn (model rollback)', () => {
  it('never writes OPENCODE_CONFIG or a key, even for a legacy hip-managed agent with a model', () => {
    const model = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }
    const { command, args, env } = buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true, boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }, model)
    expect(command).toBe('opencode')
    expect(args).toEqual(['acp', '--pure'])
    expect(env.OPENCODE_CONFIG).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('does not throw for a legacy hip-managed agent with no resolved model (no longer billed-default guard)', () => {
    expect(() => buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true }, null)).not.toThrow()
  })

  it('opencode-self mode: no key, no OPENCODE_CONFIG', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false }, null)
    expect(env.OPENCODE_CONFIG).toBeUndefined()
  })

  it('passes agent.env through to the spawn env', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false, env: { MOCK_ACP_THINK: '1' } }, null)
    expect(env.MOCK_ACP_THINK).toBe('1')
  })
})
