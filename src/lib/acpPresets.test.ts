import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { ACP_PRESETS, acpPresetById, presetInstalled, presetAdded, agentBinaryStatus, type AcpPreset } from './acpPresets'

describe('ACP_PRESETS', () => {
  it('lists the four supported providers with unique ids', () => {
    const ids = ACP_PRESETS.map((p) => p.id)
    expect(new Set(ids)).toEqual(new Set(['opencode', 'kimi-code', 'claude-code', 'codex']))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset has detectBin, command, quirks, installCmd; quirks === id', () => {
    for (const p of ACP_PRESETS) {
      expect(p.detectBin).toBeTruthy()
      expect(p.command).toBeTruthy()
      expect(p.installCmd).toBeTruthy()
      expect(p.quirks).toBe(p.id)
    }
  })

  it('adapter presets declare an authEnvVar; native ones do not', () => {
    expect(acpPresetById('claude-code')?.authEnvVar).toBe('ANTHROPIC_API_KEY')
    expect(acpPresetById('codex')?.authEnvVar).toBe('OPENAI_API_KEY')
    expect(acpPresetById('opencode')?.authEnvVar).toBeUndefined()
    expect(acpPresetById('kimi-code')?.authEnvVar).toBeUndefined()
  })

  it('adapter presets detect the AGENT command, bridge ACP via npx, and name the adapter pkg', () => {
    const cc = acpPresetById('claude-code')!
    expect(cc.detectBin).toBe('claude')
    expect(cc.command).toBe('npx')
    expect(cc.args).toEqual(['-y', '@agentclientprotocol/claude-agent-acp@latest'])
    expect(cc.adapterPkg).toBe('@agentclientprotocol/claude-agent-acp')
    const cx = acpPresetById('codex')!
    expect(cx.detectBin).toBe('codex')
    expect(cx.command).toBe('npx')
    expect(cx.args).toEqual(['-y', '@zed-industries/codex-acp'])
    expect(cx.adapterPkg).toBe('@zed-industries/codex-acp')
  })

  it('native presets launch their detected binary directly with no adapter pkg', () => {
    expect(acpPresetById('opencode')).toMatchObject({ detectBin: 'opencode', command: 'opencode', args: ['acp', '--pure'] })
    expect(acpPresetById('opencode')?.adapterPkg).toBeUndefined()
    expect(acpPresetById('kimi-code')).toMatchObject({ detectBin: 'kimi', command: 'kimi', args: ['acp'] })
    expect(acpPresetById('kimi-code')?.adapterPkg).toBeUndefined()
  })

  it('looks presets up by id', () => {
    expect(acpPresetById('codex')?.name).toBe('Codex')
    expect(acpPresetById('nope')).toBeUndefined()
  })
})

const mk = (over: Partial<AcpPreset>): AcpPreset => ({
  id: 'x', name: 'X', icon: 'code', detectBin: 'x', command: 'x', args: [], quirks: 'x', installCmd: 'i', ...over,
})

describe('presetInstalled', () => {
  it('true iff the agent detect binary is present', () => {
    expect(presetInstalled(mk({ detectBin: 'claude' }), { claude: true })).toBe(true)
    expect(presetInstalled(mk({ detectBin: 'claude' }), { claude: false })).toBe(false)
    expect(presetInstalled(mk({ detectBin: 'claude' }), {})).toBe(false)
  })
})

describe('presetAdded', () => {
  it('true when an agent carries this preset id as its quirks', () => {
    const p = mk({ id: 'codex', quirks: 'codex' })
    expect(presetAdded(p, [{ quirks: 'opencode' }, { quirks: 'codex' }])).toBe(true)
    expect(presetAdded(p, [{ quirks: 'opencode' }])).toBe(false)
    expect(presetAdded(p, [{}])).toBe(false)
  })
})

describe('agentBinaryStatus', () => {
  const agent = (quirks: string): AgentConfig =>
    ({
      id: 'a1',
      name: 'Test',
      kind: 'acp',
      command: quirks,
      args: [],
      enabled: true,
      quirks,
    }) as AgentConfig

  it('returns undefined for agents that do not match a preset', () => {
    expect(agentBinaryStatus(agent('custom-tool'), {})).toBeUndefined()
    expect(agentBinaryStatus({ ...agent('opencode'), quirks: undefined }, {})).toBeUndefined()
  })

  it('reports installed when the preset binary is present', () => {
    expect(agentBinaryStatus(agent('opencode'), { opencode: true })).toEqual({
      preset: acpPresetById('opencode'),
      installed: true,
    })
  })

  it('reports not installed when the preset binary is missing', () => {
    expect(agentBinaryStatus(agent('opencode'), { opencode: false })).toEqual({
      preset: acpPresetById('opencode'),
      installed: false,
    })
    expect(agentBinaryStatus(agent('opencode'), {})).toEqual({
      preset: acpPresetById('opencode'),
      installed: false,
    })
  })

  it('maps kimi-code to the kimi detect binary', () => {
    expect(agentBinaryStatus(agent('kimi-code'), { kimi: true })).toEqual({
      preset: acpPresetById('kimi-code'),
      installed: true,
    })
  })
})
