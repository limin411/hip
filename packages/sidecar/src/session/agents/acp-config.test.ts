import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { buildAcpSpawn } from './acp-config.js'

const baseAgent: any = { id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'], transport: 'rich', enabled: true, quirks: 'opencode' }

describe('buildAcpSpawn', () => {
  it('opencode-self mode: no key, no OPENCODE_CONFIG', () => {
    const { command, args, env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false }, null)
    expect(command).toBe('opencode')
    expect(args).toEqual(['acp', '--pure'])
    expect(env.OPENCODE_CONFIG).toBeUndefined()
  })

  it('hip-managed mode: writes an OPENCODE_CONFIG file with model + key env', () => {
    const model = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true, boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }, model)
    expect(env.OPENCODE_CONFIG).toBeTruthy()
    expect(existsSync(env.OPENCODE_CONFIG!)).toBe(true)
    const cfg = JSON.parse(readFileSync(env.OPENCODE_CONFIG!, 'utf8'))
    expect(cfg.model).toBe('deepseek/deepseek-chat')        // G1: model MUST be set
    expect(cfg.provider.deepseek.options.apiKey).toBe('{env:DEEPSEEK_API_KEY}') // G3: substitution via file, not CONTENT
    expect(cfg.provider.deepseek.options.baseURL).toBe('https://api.deepseek.com/v1')
    expect(env.DEEPSEEK_API_KEY).toBe('sk-test')
    // The raw key must NOT be written to disk — it stays in the spawn env, referenced via {env:}.
    expect(readFileSync(env.OPENCODE_CONFIG!, 'utf8')).not.toContain('sk-test')
  })

  it('hip-managed mode with NO resolved model throws (G1 — never silently bill the default model)', () => {
    expect(() => buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true }, null))
      .toThrowError(/hip-managed/i)
  })

  it('passes agent.env through to the spawn env (both modes)', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false, env: { MOCK_ACP_THINK: '1' } }, null)
    expect(env.MOCK_ACP_THINK).toBe('1')
  })
})
