import { describe, it, expect } from 'vitest'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from './agentDraft'

const base: AgentForm = {
  name: 'Claude Code',
  command: 'claude',
  args: '--loop --json',
  transport: 'rich',
  acceptsModelConfig: false,
  boundModelKey: '',
  enabled: true,
}

describe('isAgentDraftValid', () => {
  it('requires name and command', () => {
    expect(isAgentDraftValid(base)).toBe(true)
    expect(isAgentDraftValid({ ...base, name: '  ' })).toBe(false)
    expect(isAgentDraftValid({ ...base, command: '' })).toBe(false)
  })
  it('requires a model when acceptsModelConfig is on', () => {
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: '' })).toBe(false)
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: 'anthropic/claude-opus-4' })).toBe(true)
  })
})

describe('buildAgentDraft', () => {
  it('trims fields and whitespace-splits args', () => {
    const d = buildAgentDraft({ ...base, name: '  X ', command: '  bin ', args: '  --a   --b ' })
    expect(d).toMatchObject({ name: 'X', kind: 'custom', command: 'bin', args: ['--a', '--b'], enabled: true })
  })
  it('empty args → []', () => {
    expect(buildAgentDraft({ ...base, args: '   ' }).args).toEqual([])
  })
  it('omits boundModel when acceptsModelConfig is off, even if a key is set', () => {
    expect(buildAgentDraft({ ...base, acceptsModelConfig: false, boundModelKey: 'anthropic/x' }).boundModel).toBeUndefined()
  })
  it('splits boundModel on the FIRST slash (modelID may contain slashes)', () => {
    const d = buildAgentDraft({ ...base, acceptsModelConfig: true, boundModelKey: 'openrouter/meta/llama-3' })
    expect(d.boundModel).toEqual({ providerID: 'openrouter', modelID: 'meta/llama-3' })
  })
})
