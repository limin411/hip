import { describe, it, expect } from 'vitest'
import { buildInitPrompt, extractInitFocus } from './initPrompt'

describe('initPrompt', () => {
  it('buildInitPrompt includes AGENTS.md guidance and investigation steps', () => {
    const p = buildInitPrompt()
    expect(p).toContain('AGENTS.md')
    expect(p).toContain('README')
    expect(p).toContain('CLAUDE.md')
    expect(p).toContain('When in doubt, omit')
  })

  it('buildInitPrompt appends user focus when provided', () => {
    const p = buildInitPrompt('  prefer monorepo map  ')
    expect(p).toContain('User-provided focus or constraints')
    expect(p).toContain('prefer monorepo map')
  })

  it('buildInitPrompt ignores blank focus', () => {
    expect(buildInitPrompt('   ')).toBe(buildInitPrompt())
    expect(buildInitPrompt()).not.toContain('User-provided focus')
  })

  it('extractInitFocus reads trailing text after /init', () => {
    expect(extractInitFocus('/init')).toBeUndefined()
    expect(extractInitFocus('/init ')).toBeUndefined()
    expect(extractInitFocus('/init focus on tests')).toBe('focus on tests')
    expect(extractInitFocus('please /init testing quirks')).toBe('testing quirks')
  })
})
