import { describe, it, expect } from 'vitest'
import { ACP_PRESETS, acpPresetById, presetInstalled, presetAdded, type AcpPreset } from './acpPresets'

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

  it('adapter presets detect the AGENT command and bridge ACP via npx', () => {
    const cc = acpPresetById('claude-code')!
    expect(cc.detectBin).toBe('claude')
    expect(cc.command).toBe('npx')
    expect(cc.args).toEqual(['-y', '@agentclientprotocol/claude-agent-acp@latest'])
    const cx = acpPresetById('codex')!
    expect(cx.detectBin).toBe('codex')
    expect(cx.command).toBe('npx')
    expect(cx.args).toEqual(['-y', '@zed-industries/codex-acp'])
  })

  it('native presets launch their detected binary directly (OpenCode keeps acp --pure)', () => {
    expect(acpPresetById('opencode')).toMatchObject({ detectBin: 'opencode', command: 'opencode', args: ['acp', '--pure'] })
    expect(acpPresetById('kimi-code')).toMatchObject({ detectBin: 'kimi', command: 'kimi', args: ['acp'] })
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
