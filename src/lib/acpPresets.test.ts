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

  it('claude-code keeps a legacy bin fallback', () => {
    expect(acpPresetById('claude-code')?.legacyBin).toBe('claude-code-acp')
  })

  it('preserves OpenCode launch args (acp --pure)', () => {
    expect(acpPresetById('opencode')).toMatchObject({ command: 'opencode', args: ['acp', '--pure'] })
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
  it('true when the primary detect binary is present', () => {
    expect(presetInstalled(mk({ detectBin: 'opencode' }), { opencode: true })).toBe(true)
    expect(presetInstalled(mk({ detectBin: 'opencode' }), { opencode: false })).toBe(false)
    expect(presetInstalled(mk({ detectBin: 'opencode' }), {})).toBe(false)
  })
  it('true when only the legacy binary is present', () => {
    const p = mk({ detectBin: 'claude-agent-acp', legacyBin: 'claude-code-acp' })
    expect(presetInstalled(p, { 'claude-agent-acp': false, 'claude-code-acp': true })).toBe(true)
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
