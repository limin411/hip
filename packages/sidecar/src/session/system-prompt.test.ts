import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, childSystemPrompt } from './system-prompt.js'

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
})

describe('childSystemPrompt', () => {
  it('carries the hip identity into delegated sub-agents', () => {
    const s = childSystemPrompt('refactor the parser', '/tmp/proj')
    expect(s).toMatch(/you are hip/i)
    expect(s).toMatch(/never claim/i)
    expect(s).toContain('refactor the parser')
  })
})
