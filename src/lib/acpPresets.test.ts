import { describe, it, expect } from 'vitest'
import { ACP_PRESETS, acpPresetById } from './acpPresets'

describe('ACP_PRESETS', () => {
  it('has a single, available OpenCode preset that seeds the OpenCode defaults', () => {
    const oc = ACP_PRESETS.filter((p) => p.id === 'opencode')
    expect(oc).toHaveLength(1)
    expect(oc[0].status).toBe('available')
    expect(oc[0].command).not.toBe('')
    expect(oc[0].quirks).toBe('opencode')
    expect(oc[0].authModeDefault).toBe('opencode-self')
  })

  it('reserves claude-code, codex and kimi-code as coming-soon with no command', () => {
    for (const id of ['claude-code', 'codex', 'kimi-code']) {
      const p = acpPresetById(id)
      expect(p?.status).toBe('coming-soon')
      expect(p?.command).toBe('')
    }
  })

  it('has unique preset ids', () => {
    const ids = ACP_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('looks presets up by id', () => {
    expect(acpPresetById('opencode')?.name).toBe('OpenCode')
    expect(acpPresetById('nope')).toBeUndefined()
  })
})
