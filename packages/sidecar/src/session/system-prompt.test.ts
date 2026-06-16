import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, childSystemPrompt, buildManagedAgentPrompt } from './system-prompt.js'

describe('buildSystemPrompt', () => {
  it('includes the cwd, the path convention, and the anti-phantom rule', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toContain('/tmp/proj')
    expect(s).toContain('write_file')
    expect(s).toContain('write_todos')
    expect(s).toMatch(/delegate it to/i)
    expect(s).toMatch(/MUST NOT claim/i)
  })

  it('gives the agent the hip identity and forbids impersonating other assistants', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toMatch(/you are hip/i)
    expect(s).toMatch(/never claim/i)
    expect(s).toMatch(/Claude/)
  })

  it('appends per-conversation user instructions when present', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', userInstructions: 'Always answer in French.' })
    expect(s).toContain('Always answer in French.')
  })

  it('omits the user-instructions section when blank', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', userInstructions: '   ' })
    expect(s).not.toMatch(/Additional instructions/i)
  })

  it('includes proactive-commit + branch guidance for the git tools', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toMatch(/git_commit/)
    expect(s).toMatch(/git_create_branch/)
    expect(s).toMatch(/git_switch_branch/)
    expect(s).toMatch(/proactively|after a coherent unit/i)
  })

  it('orders git guidance after the cwd block and before the anti-phantom rule', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    const cwdIdx = s.indexOf('working directory')
    const gitIdx = s.indexOf('git_commit')
    const antiIdx = s.indexOf('MUST NOT claim')
    expect(cwdIdx).toBeGreaterThanOrEqual(0)
    expect(gitIdx).toBeGreaterThan(cwdIdx)
    expect(antiIdx).toBeGreaterThan(gitIdx)
  })
})

describe('childSystemPrompt', () => {
  it('carries the hip identity into delegated sub-agents', () => {
    const s = childSystemPrompt('refactor the parser', '/tmp/proj')
    expect(s).toMatch(/you are hip/i)
    expect(s).toMatch(/never claim/i)
    expect(s).toContain('refactor the parser')
  })
})

describe('buildManagedAgentPrompt', () => {
  it('embeds the persona, the cwd, and the granted tool names', () => {
    const p = buildManagedAgentPrompt({
      cwd: '/proj',
      persona: 'You are a meticulous code reviewer.',
      toolNames: ['read_file', 'grep'],
    })
    expect(p).toContain('You are a meticulous code reviewer.')
    expect(p).toContain('/proj')
    expect(p).toContain('read_file')
    expect(p).toContain('grep')
  })
  it('omits git guidance when no git tool is granted', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'] })
    expect(p).not.toContain('git_commit')
  })
  it('includes git guidance when a git tool is granted', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file', 'git_commit'] })
    expect(p).toContain('git_commit')
  })
  it('forbids claiming a non-hip identity', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: [] })
    expect(p).toContain('hip')
  })
})

describe('buildSystemPrompt skills block', () => {
  const skills = [
    { id: 'fmt', name: 'formatter', description: 'Format code', dir: '/s/fmt', hasScripts: true },
    { id: 'lint', name: 'linter', description: 'Lint code', dir: '/s/lint', hasScripts: false },
  ]

  it('omits the skills section when no skills are given', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).not.toMatch(/可用 Skills/)
  })

  it('lists enabled skill names and descriptions and mentions use_skill', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills })
    expect(s).toMatch(/可用 Skills/)
    expect(s).toContain('formatter')
    expect(s).toContain('Format code')
    expect(s).toContain('linter')
    expect(s).toMatch(/use_skill/)
  })

  it('omits the skills section when skills is an empty array', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: [] })
    expect(s).not.toMatch(/可用 Skills/)
  })
})

describe('buildManagedAgentPrompt skills block', () => {
  const skills = [{ id: 'fmt', name: 'formatter', description: 'Format code', dir: '/s/fmt', hasScripts: true }]

  it('injects the skills block when use_skill is in the granted tools', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill', 'read_file'], skills })
    expect(s).toMatch(/可用 Skills/)
    expect(s).toContain('formatter')
  })

  it('omits the skills block when use_skill is not granted', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['read_file'], skills })
    expect(s).not.toMatch(/可用 Skills/)
  })

  it('omits the skills block when no skills are provided even with use_skill granted', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill'] })
    expect(s).not.toMatch(/可用 Skills/)
  })
})
