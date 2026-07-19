import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import {
  ACP_PRESETS,
  acpDetectNames,
  acpPresetById,
  presetInstalled,
  presetAgentInstalled,
  presetAdapterInstalled,
  presetAdded,
  agentBinaryStatus,
  type AcpPreset,
} from './acpPresets'

describe('ACP_PRESETS', () => {
  it('lists the five supported providers with unique ids', () => {
    const ids = ACP_PRESETS.map((p) => p.id)
    expect(new Set(ids)).toEqual(new Set(['opencode', 'grok-build', 'pi', 'claude-code', 'codex']))
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

  it('key-injecting presets declare an authEnvVar; pure self-managed ones do not', () => {
    expect(acpPresetById('claude-code')?.authEnvVar).toBe('ANTHROPIC_API_KEY')
    expect(acpPresetById('codex')?.authEnvVar).toBe('OPENAI_API_KEY')
    expect(acpPresetById('grok-build')?.authEnvVar).toBe('XAI_API_KEY')
    expect(acpPresetById('opencode')?.authEnvVar).toBeUndefined()
    expect(acpPresetById('pi')?.authEnvVar).toBeUndefined()
  })

  it('adapter presets require a global adapter bin and install cmd; launch that bin directly', () => {
    const pi = acpPresetById('pi')!
    expect(pi.detectBin).toBe('pi')
    expect(pi.command).toBe('pi-acp')
    expect(pi.args).toEqual([])
    expect(pi.adapterPkg).toBe('pi-acp')
    expect(pi.adapterBin).toBe('pi-acp')
    expect(pi.adapterInstallCmd).toBeTruthy()

    const cc = acpPresetById('claude-code')!
    expect(cc.detectBin).toBe('claude')
    expect(cc.command).toBe('claude-agent-acp')
    expect(cc.args).toEqual([])
    expect(cc.adapterPkg).toBe('@agentclientprotocol/claude-agent-acp')
    expect(cc.adapterBin).toBe('claude-agent-acp')
    expect(cc.adapterInstallCmd).toBeTruthy()

    const cx = acpPresetById('codex')!
    expect(cx.detectBin).toBe('codex')
    expect(cx.command).toBe('codex-acp')
    expect(cx.args).toEqual([])
    expect(cx.adapterPkg).toBe('@zed-industries/codex-acp')
    expect(cx.adapterBin).toBe('codex-acp')
    expect(cx.adapterInstallCmd).toBeTruthy()
  })

  it('native presets launch their detected binary directly with no adapter', () => {
    expect(acpPresetById('opencode')).toMatchObject({
      detectBin: 'opencode',
      command: 'opencode',
      args: ['acp', '--pure'],
    })
    expect(acpPresetById('opencode')?.adapterPkg).toBeUndefined()
    expect(acpPresetById('opencode')?.adapterBin).toBeUndefined()

    expect(acpPresetById('grok-build')).toMatchObject({
      detectBin: 'grok',
      command: 'grok',
      args: ['agent', 'stdio'],
      quirks: 'grok-build',
      icon: 'sparkles',
    })
    expect(acpPresetById('grok-build')?.adapterPkg).toBeUndefined()
    expect(acpPresetById('grok-build')?.adapterBin).toBeUndefined()
    expect(acpPresetById('grok-build')?.installCmd).toMatch(/x\.ai\/cli/)
  })

  it('adapterPkg and adapterBin are paired when either is set', () => {
    for (const p of ACP_PRESETS) {
      if (p.adapterPkg || p.adapterBin) {
        expect(p.adapterPkg).toBeTruthy()
        expect(p.adapterBin).toBeTruthy()
        expect(p.adapterInstallCmd).toBeTruthy()
      }
    }
  })

  it('looks presets up by id', () => {
    expect(acpPresetById('codex')?.name).toBe('Codex')
    expect(acpPresetById('pi')?.name).toBe('Pi')
    expect(acpPresetById('grok-build')?.name).toBe('Grok Build')
    expect(acpPresetById('nope')).toBeUndefined()
  })

  it('acpDetectNames includes agent and adapter binaries', () => {
    const names = acpDetectNames()
    expect(names).toEqual(expect.arrayContaining([
      'opencode', 'grok', 'pi', 'pi-acp', 'claude', 'claude-agent-acp', 'codex', 'codex-acp',
    ]))
    expect(new Set(names).size).toBe(names.length)
  })
})

const mk = (over: Partial<AcpPreset>): AcpPreset => ({
  id: 'x', name: 'X', icon: 'code', detectBin: 'x', command: 'x', args: [], quirks: 'x', installCmd: 'i', ...over,
})

describe('preset install helpers', () => {
  it('presetAgentInstalled checks detectBin only', () => {
    const p = mk({ detectBin: 'claude', adapterBin: 'claude-agent-acp' })
    expect(presetAgentInstalled(p, { claude: true, 'claude-agent-acp': false })).toBe(true)
    expect(presetAgentInstalled(p, { claude: false, 'claude-agent-acp': true })).toBe(false)
  })

  it('presetAdapterInstalled is true when no adapterBin; else checks adapterBin', () => {
    expect(presetAdapterInstalled(mk({ detectBin: 'opencode' }), {})).toBe(true)
    expect(presetAdapterInstalled(mk({ detectBin: 'grok' }), {})).toBe(true)
    const p = mk({ detectBin: 'pi', adapterBin: 'pi-acp' })
    expect(presetAdapterInstalled(p, { 'pi-acp': true })).toBe(true)
    expect(presetAdapterInstalled(p, { 'pi-acp': false })).toBe(false)
    expect(presetAdapterInstalled(p, {})).toBe(false)
  })

  it('presetInstalled requires agent + adapter when bridged', () => {
    const native = mk({ detectBin: 'opencode' })
    expect(presetInstalled(native, { opencode: true })).toBe(true)
    expect(presetInstalled(native, { opencode: false })).toBe(false)

    const grok = mk({ detectBin: 'grok' })
    expect(presetInstalled(grok, { grok: true })).toBe(true)
    expect(presetInstalled(grok, { grok: false })).toBe(false)

    const bridged = mk({ detectBin: 'pi', adapterBin: 'pi-acp' })
    expect(presetInstalled(bridged, { pi: true, 'pi-acp': true })).toBe(true)
    expect(presetInstalled(bridged, { pi: true, 'pi-acp': false })).toBe(false)
    expect(presetInstalled(bridged, { pi: false, 'pi-acp': true })).toBe(false)
  })
})

describe('presetAdded', () => {
  it('true when an agent carries this preset id as its quirks', () => {
    const p = mk({ id: 'codex', quirks: 'codex' })
    expect(presetAdded(p, [{ quirks: 'opencode' }, { quirks: 'codex' }])).toBe(true)
    expect(presetAdded(p, [{ quirks: 'opencode' }])).toBe(false)
    expect(presetAdded(p, [{}])).toBe(false)
    expect(presetAdded(mk({ id: 'grok-build', quirks: 'grok-build' }), [{ quirks: 'grok-build' }])).toBe(true)
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

  it('reports installed when native binary is present', () => {
    expect(agentBinaryStatus(agent('opencode'), { opencode: true })).toEqual({
      preset: acpPresetById('opencode'),
      agentInstalled: true,
      adapterInstalled: true,
      installed: true,
    })
    expect(agentBinaryStatus(agent('grok-build'), { grok: true })).toEqual({
      preset: acpPresetById('grok-build'),
      agentInstalled: true,
      adapterInstalled: true,
      installed: true,
    })
  })

  it('reports not installed when the preset binary is missing', () => {
    expect(agentBinaryStatus(agent('opencode'), { opencode: false })).toEqual({
      preset: acpPresetById('opencode'),
      agentInstalled: false,
      adapterInstalled: true,
      installed: false,
    })
    expect(agentBinaryStatus(agent('grok-build'), { grok: false })).toMatchObject({
      agentInstalled: false,
      adapterInstalled: true,
      installed: false,
    })
  })

  it('maps pi readiness to agent + adapter bins', () => {
    expect(agentBinaryStatus(agent('pi'), { pi: true, 'pi-acp': true })).toEqual({
      preset: acpPresetById('pi'),
      agentInstalled: true,
      adapterInstalled: true,
      installed: true,
    })
    expect(agentBinaryStatus(agent('pi'), { pi: true, 'pi-acp': false })).toMatchObject({
      agentInstalled: true,
      adapterInstalled: false,
      installed: false,
    })
    expect(agentBinaryStatus(agent('pi'), { pi: false, 'pi-acp': true })).toMatchObject({
      agentInstalled: false,
      adapterInstalled: true,
      installed: false,
    })
  })
})
