import { describe, it, expect } from 'vitest'
import { pickProjectGuidanceName, projectGuidancePreview } from './projectGuidance'

describe('projectGuidance', () => {
  it('prefers AGENTS.md over CLAUDE.md', () => {
    expect(pickProjectGuidanceName(['CLAUDE.md', 'AGENTS.md', 'src'])).toBe('AGENTS.md')
    expect(pickProjectGuidanceName(['CLAUDE.md'])).toBe('CLAUDE.md')
    expect(pickProjectGuidanceName(['README.md'])).toBeNull()
  })

  it('previews content with ellipsis', () => {
    expect(projectGuidancePreview('short')).toBe('short')
    expect(projectGuidancePreview('x'.repeat(250)).endsWith('…')).toBe(true)
  })
})
