import { describe, it, expect } from 'vitest'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from './agentDraft'

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
  allowedSkills: [],
  allowedMcpServers: [],
}

describe('isAgentDraftValid', () => {
  it('requires name and command', () => {
    expect(isAgentDraftValid(base)).toBe(true)
    expect(isAgentDraftValid({ ...base, name: '  ' })).toBe(false)
    expect(isAgentDraftValid({ ...base, command: '' })).toBe(false)
  })
  it('custom agents never require a model (rollback)', () => {
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: '' })).toBe(true)
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: false, boundModelKey: '' })).toBe(true)
  })
  it('acp agents never require a model regardless of legacy authMode (rollback)', () => {
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'hip-managed', boundModelKey: '' })).toBe(true)
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
  it('custom agents never emit a boundModel, even when a key is set (rollback)', () => {
    expect(buildAgentDraft({ ...base, acceptsModelConfig: false, boundModelKey: 'anthropic/x' }).boundModel).toBeUndefined()
    expect(buildAgentDraft({ ...base, acceptsModelConfig: true, boundModelKey: 'openrouter/meta/llama-3' }).boundModel).toBeUndefined()
  })
  it('acp: no model pushed, acceptsModelConfig false, no authMode field (rollback)', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'opencode-self', quirks: 'opencode', boundModelKey: 'anthropic/x' })
    expect(d).toMatchObject({ kind: 'acp', quirks: 'opencode', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
    expect('authMode' in d).toBe(false)
  })
  it('acp ignores a legacy hip-managed selection: still no model, no authMode (rollback)', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'hip-managed', quirks: 'opencode', boundModelKey: 'anthropic/claude-opus-4' })
    expect(d).toMatchObject({ kind: 'acp', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
    expect('authMode' in d).toBe(false)
  })
  it('non-acp forms do not emit an authMode field', () => {
    expect('authMode' in buildAgentDraft({ ...base, kind: 'custom' })).toBe(false)
  })
  it('carries a trimmed description, omitting it when blank', () => {
    expect(buildAgentDraft({ ...base, description: '  edits code  ' }).description).toBe('edits code')
    expect(buildAgentDraft({ ...base, description: '   ' }).description).toBeUndefined()
  })
  it('external (custom/acp) drafts never emit allowedSkills / allowedMcpServers', () => {
    const d = buildAgentDraft({ ...base, allowedSkills: ['s1'], allowedMcpServers: ['m1'] })
    expect('allowedSkills' in d).toBe(false)
    expect('allowedMcpServers' in d).toBe(false)
  })
})

const internalBase: AgentForm = {
  name: 'Reviewer', kind: 'internal', command: '', args: '', transport: 'thin',
  acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self', enabled: true,
  prompt: 'You review code.', allowedSkills: [], allowedMcpServers: [],
}

describe('internal agents', () => {
  it('requires a name and a non-empty prompt (command not required)', () => {
    expect(isAgentDraftValid(internalBase)).toBe(true)
    expect(isAgentDraftValid({ ...internalBase, prompt: '   ' })).toBe(false)
    expect(isAgentDraftValid({ ...internalBase, command: '' })).toBe(true) // command irrelevant for internal
  })
  it('builds an internal draft: prompt + allowedSkills/allowedMcpServers, NO allowedTools, inert command/args', () => {
    const d = buildAgentDraft({ ...internalBase, allowedSkills: ['code-review'], allowedMcpServers: ['fs'] })
    expect(d).toMatchObject({
      kind: 'internal',
      prompt: 'You review code.',
      command: '',
      args: [],
      transport: 'thin',
      acceptsModelConfig: false,
      allowedSkills: ['code-review'],
      allowedMcpServers: ['fs'],
    })
    expect('allowedTools' in d).toBe(false)
    expect(d.boundModel).toBeUndefined()
  })
  it('empty skill/mcp selections emit empty arrays (explicit none)', () => {
    const d = buildAgentDraft(internalBase)
    expect(d).toMatchObject({ allowedSkills: [], allowedMcpServers: [] })
    expect('allowedTools' in d).toBe(false)
  })
  it('copies the arrays (does not alias the form arrays)', () => {
    const skills = ['a']
    const mcp = ['b']
    const d = buildAgentDraft({ ...internalBase, allowedSkills: skills, allowedMcpServers: mcp })
    expect(d.allowedSkills).toEqual(['a'])
    expect(d.allowedSkills).not.toBe(skills)
    expect(d.allowedMcpServers).not.toBe(mcp)
  })
  it('binds a model when a key is chosen', () => {
    const d = buildAgentDraft({ ...internalBase, boundModelKey: 'anthropic/claude-opus-4' })
    expect(d.boundModel).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
  })
})
