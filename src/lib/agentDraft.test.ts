import { describe, it, expect } from 'vitest'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from './agentDraft'
import { TOOL_GROUPS } from './agentTools'

const base: AgentForm = {
  name: 'Claude Code',
  kind: 'custom',
  command: 'claude',
  args: '--loop --json',
  transport: 'rich',
  acceptsModelConfig: false,
  boundModelKey: '',
  authMode: 'opencode-self',
  enabled: true,
  prompt: '',
  toolsRead: true,
  toolsEdit: true,
  toolsPlan: true,
  toolsGit: false,
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
  it('acp + hip-managed requires a model; opencode-self does not', () => {
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'hip-managed', boundModelKey: '' })).toBe(false)
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'hip-managed', boundModelKey: 'anthropic/x' })).toBe(true)
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'opencode-self', boundModelKey: '' })).toBe(true)
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
  it('acp + opencode-self: authMode carried, no model, acceptsModelConfig false', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'opencode-self', quirks: 'opencode', boundModelKey: 'anthropic/x' })
    expect(d).toMatchObject({ kind: 'acp', authMode: 'opencode-self', quirks: 'opencode', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
  })
  it('acp + hip-managed: acceptsModelConfig true with the chosen model', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'hip-managed', quirks: 'opencode', boundModelKey: 'anthropic/claude-opus-4' })
    expect(d).toMatchObject({ kind: 'acp', authMode: 'hip-managed', acceptsModelConfig: true })
    expect(d.boundModel).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
  })
  it('non-acp forms do not emit an authMode field', () => {
    expect('authMode' in buildAgentDraft({ ...base, kind: 'custom' })).toBe(false)
  })
  it('carries a trimmed description, omitting it when blank', () => {
    const b = { name: 'A', kind: 'custom' as const, command: 'c', args: '', transport: 'thin' as const, acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self' as const, enabled: true, prompt: '', toolsRead: true, toolsEdit: true, toolsPlan: true, toolsGit: false }
    expect(buildAgentDraft({ ...b, description: '  edits code  ' }).description).toBe('edits code')
    expect(buildAgentDraft({ ...b, description: '   ' }).description).toBeUndefined()
  })
})

const internalBase: AgentForm = {
  name: 'Reviewer', kind: 'internal', command: '', args: '', transport: 'thin',
  acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self', enabled: true,
  prompt: 'You review code.', toolsRead: true, toolsEdit: false, toolsPlan: true, toolsGit: false,
}

describe('internal agents', () => {
  it('requires a name and a non-empty prompt (command not required)', () => {
    expect(isAgentDraftValid(internalBase)).toBe(true)
    expect(isAgentDraftValid({ ...internalBase, prompt: '   ' })).toBe(false)
    expect(isAgentDraftValid({ ...internalBase, command: '' })).toBe(true) // command irrelevant
  })
  it('builds an internal draft: prompt + allowedTools from groups, inert command/args', () => {
    const d = buildAgentDraft(internalBase)
    expect(d).toMatchObject({ kind: 'internal', prompt: 'You review code.', command: '', args: [], transport: 'thin', acceptsModelConfig: false })
    expect(d.allowedTools).toEqual([...TOOL_GROUPS.read, ...TOOL_GROUPS.plan])
    expect(d.boundModel).toBeUndefined()
  })
  it('binds a model when a key is chosen', () => {
    const d = buildAgentDraft({ ...internalBase, boundModelKey: 'anthropic/claude-opus-4' })
    expect(d.boundModel).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
  })
})
