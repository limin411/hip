import { describe, it, expect } from 'vitest'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from './agentDraft'

const base = {
  name: 'Claude Code',
  kind: 'custom',
  command: 'claude',
  args: '--loop --json',
  boundModelKey: '',
  enabled: true,
  prompt: '',
  allowedSkills: [],
  allowedMcpServers: [],
} as AgentForm

describe('isAgentDraftValid', () => {
  it('requires name', () => {
    expect(isAgentDraftValid(base)).toBe(true)
    expect(isAgentDraftValid({ ...base, name: '  ' })).toBe(false)
    expect(isAgentDraftValid({ ...base, command: '' })).toBe(true)
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
  name: 'Reviewer', kind: 'internal', command: '', args: '',
  boundModelKey: '', enabled: true,
  prompt: 'You review code.', allowedSkills: [], allowedMcpServers: [],
}

describe('internal agents', () => {
  it('requires a name and a non-empty prompt (command not required)', () => {
    expect(isAgentDraftValid(internalBase)).toBe(true)
    expect(isAgentDraftValid({ ...internalBase, prompt: '   ' })).toBe(false)
    expect(isAgentDraftValid({ ...internalBase, command: '' })).toBe(true) // command irrelevant for internal
  })
  it('builds an internal draft: prompt + allowedSkills/allowedMcpServers, allowedTools cleared to undefined, inert command/args', () => {
    const d = buildAgentDraft({ ...internalBase, allowedSkills: ['code-review'], allowedMcpServers: ['fs'] })
    expect(d).toMatchObject({
      kind: 'internal',
      prompt: 'You review code.',
      command: '',
      args: [],
      allowedSkills: ['code-review'],
      allowedMcpServers: ['fs'],
    })
    // Explicitly emits allowedTools: undefined so the shallow merge in updateAgent clears any legacy value.
    expect('allowedTools' in d).toBe(true)
    expect(d.allowedTools).toBeUndefined()
    expect(d.boundModel).toBeUndefined()
  })
  it('empty skill/mcp selections emit empty arrays (explicit none) and clear allowedTools', () => {
    const d = buildAgentDraft(internalBase)
    expect(d).toMatchObject({ allowedSkills: [], allowedMcpServers: [] })
    expect('allowedTools' in d).toBe(true)
    expect(d.allowedTools).toBeUndefined()
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

const acpForm = (over: Partial<AgentForm>): AgentForm => ({
  name: 'Claude', description: '', kind: 'acp', command: 'claude-agent-acp', args: '',
  boundModelKey: '',
  quirks: 'claude-code', prompt: '', allowedSkills: [], allowedMcpServers: [], enabled: true,
  apiKey: '', authEnvVar: 'ANTHROPIC_API_KEY', env: undefined, ...over,
} as AgentForm)

describe('buildAgentDraft env / apiKey', () => {
  it('writes the api key into env[authEnvVar] when provided', () => {
    const d = buildAgentDraft(acpForm({ apiKey: 'sk-123' }))
    expect(d.env).toEqual({ ANTHROPIC_API_KEY: 'sk-123' })
  })
  it('omits env entirely when the api key is blank and no other env', () => {
    const d = buildAgentDraft(acpForm({ apiKey: '   ' }))
    expect(d.env).toBeUndefined()
  })
  it('preserves other env keys and drops a cleared auth key', () => {
    const d = buildAgentDraft(acpForm({ apiKey: '', env: { ANTHROPIC_API_KEY: 'old', FOO: 'bar' } }))
    expect(d.env).toEqual({ FOO: 'bar' })
  })
  it('native presets (no authEnvVar) never synthesize an auth env', () => {
    const d = buildAgentDraft(acpForm({ quirks: 'opencode', authEnvVar: undefined, apiKey: 'ignored' }))
    expect(d.env).toBeUndefined()
  })
})
