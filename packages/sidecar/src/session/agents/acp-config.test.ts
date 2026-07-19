import { describe, it, expect } from 'vitest'
import { buildAcpSpawn } from './acp-config.js'

const baseAgent: any = { id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'], enabled: true, quirks: 'opencode' }

describe('buildAcpSpawn (model rollback)', () => {
  it('never writes OPENCODE_CONFIG or a key, even for a legacy hip-managed agent with a model', () => {
    const model = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }
    const { command, args, env } = buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }, model)
    expect(command).toBe('opencode')
    expect(args).toEqual(['acp', '--pure'])
    expect(env.OPENCODE_CONFIG).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
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
