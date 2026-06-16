import { describe, it, expect } from 'vitest'
import { HELP_SECTIONS, helpSectionById } from './agentHelp'
import { ACP_PRESETS } from './acpPresets'

describe('HELP_SECTIONS', () => {
  it('has unique ids', () => {
    const ids = HELP_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a help section for every ACP preset docsId', () => {
    for (const preset of ACP_PRESETS) {
      expect(helpSectionById(preset.docsId), `missing help for ${preset.docsId}`).toBeDefined()
    }
  })

  it('marks coming-soon providers and keeps OpenCode available', () => {
    expect(helpSectionById('acp-opencode')?.status).toBe('available')
    for (const id of ['acp-claude-code', 'acp-codex', 'acp-kimi-code']) {
      expect(helpSectionById(id)?.status).toBe('coming-soon')
    }
  })

  it('resolves overview and returns undefined for an unknown id', () => {
    expect(helpSectionById('overview')?.status).toBe('available')
    expect(helpSectionById('nope')).toBeUndefined()
  })
})
