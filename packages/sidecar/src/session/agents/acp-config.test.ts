import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAcpSpawn, resolveAcpHostConfig } from './acp-config.js'

const tmpDirs: string[] = []
afterEach(() => {
  delete process.env.HIP_CONFIG_PATH
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
})

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

describe('resolveAcpHostConfig', () => {
  it('defaults fsBridge=true, forwardMcp=false, fsReadMaxBytes=2e6 when [acp] absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-host-'))
    tmpDirs.push(dir)
    const p = join(dir, 'hip.toml')
    writeFileSync(p, 'version = 1\n')
    process.env.HIP_CONFIG_PATH = p
    expect(resolveAcpHostConfig()).toEqual({
      fsBridge: true,
      forwardMcp: false,
      fsReadMaxBytes: 2_000_000,
    })
  })

  it('honors snake_case [acp] fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-host-'))
    tmpDirs.push(dir)
    const p = join(dir, 'hip.toml')
    writeFileSync(p, `version = 1

[acp]
fs_bridge = false
forward_mcp = true
fs_read_max_bytes = 5000
`)
    process.env.HIP_CONFIG_PATH = p
    expect(resolveAcpHostConfig()).toEqual({
      fsBridge: false,
      forwardMcp: true,
      fsReadMaxBytes: 5000,
    })
  })
})
