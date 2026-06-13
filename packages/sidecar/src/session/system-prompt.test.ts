import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './system-prompt.js'

describe('buildSystemPrompt', () => {
  it('includes the cwd, the path convention, and the anti-phantom rule', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toContain('/tmp/proj')
    expect(s).toContain('write_file')
    expect(s).toMatch(/MUST NOT claim/i)
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
