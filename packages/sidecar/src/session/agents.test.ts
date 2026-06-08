import { describe, it, expect } from 'vitest'
import { roleForName, buildSupervisorPrompt, buildSubagents } from './agents.js'

const CWD = '/Users/dev/projects/demo'

describe('roleForName', () => {
  it('maps planner/coder/reviewer to themselves', () => {
    expect(roleForName('planner')).toBe('planner')
    expect(roleForName('coder')).toBe('coder')
    expect(roleForName('reviewer')).toBe('reviewer')
  })
  it('maps undefined/unknown to supervisor', () => {
    expect(roleForName(undefined)).toBe('supervisor')
    expect(roleForName('researcher')).toBe('supervisor')
    expect(roleForName('')).toBe('supervisor')
  })
})

describe('buildSupervisorPrompt', () => {
  it('still forces use of the task tool', () => {
    expect(buildSupervisorPrompt(CWD)).toContain('task')
  })
  it('embeds the literal cwd and the sandbox-root rules', () => {
    const prompt = buildSupervisorPrompt(CWD)
    expect(prompt).toContain(CWD)
    expect(prompt).toContain('Never use `/workspace`')
  })
  it('embeds the anti-phantom rule', () => {
    expect(buildSupervisorPrompt(CWD)).toContain('MUST NOT claim')
  })
  it('tells the supervisor to only report files the coder actually wrote', () => {
    expect(buildSupervisorPrompt(CWD)).toContain('only report files the coder actually wrote')
  })
})

describe('buildSubagents', () => {
  it('returns planner, coder, reviewer in order', () => {
    expect(buildSubagents(CWD).map((s) => s.name)).toEqual(['planner', 'coder', 'reviewer'])
  })
  it('every subagent has a non-empty description + systemPrompt', () => {
    for (const sub of buildSubagents(CWD)) {
      expect(sub.description.length).toBeGreaterThan(0)
      expect(sub.systemPrompt.length).toBeGreaterThan(0)
    }
  })
  it('every subagent name resolves to a non-supervisor role', () => {
    for (const sub of buildSubagents(CWD)) {
      expect(roleForName(sub.name)).toBe(sub.name)
    }
  })
  it('injects the cwd + anti-phantom rule into the coder spec', () => {
    const coder = buildSubagents(CWD).find((s) => s.name === 'coder')!
    expect(coder.systemPrompt).toContain(CWD)
    expect(coder.systemPrompt).toContain('Never use `/workspace`')
    expect(coder.systemPrompt).toContain('MUST NOT claim')
  })
  it('leaves planner and reviewer prompts free of file-tool injection', () => {
    const subs = buildSubagents(CWD)
    expect(subs.find((s) => s.name === 'planner')!.systemPrompt).not.toContain('Never use `/workspace`')
    expect(subs.find((s) => s.name === 'reviewer')!.systemPrompt).not.toContain('Never use `/workspace`')
  })
})
