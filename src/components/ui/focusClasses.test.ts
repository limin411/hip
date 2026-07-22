// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { focusChrome, focusField, focusFieldWithin } from './focusClasses'
import { inputClassName } from './Input'

describe('focusClasses allowlist', () => {
  it('focusField is soft accent Field geometry', () => {
    expect(focusField).toContain('focus-visible:border-accent')
    expect(focusField).toContain('focus-visible:ring-[3px]')
    expect(focusField).toContain('focus-visible:ring-accent/10')
    expect(focusField).not.toContain('ring-focus-ring')
    expect(focusField).not.toContain('ring-accent/60')
  })

  it('focusFieldWithin matches Field ring alpha for containers', () => {
    expect(focusFieldWithin).toContain('focus-within:border-accent')
    expect(focusFieldWithin).toContain('focus-within:ring-[3px]')
    expect(focusFieldWithin).toContain('focus-within:ring-accent/10')
  })

  it('focusChrome is quiet ink ring only', () => {
    expect(focusChrome).toContain('focus-visible:ring-2')
    expect(focusChrome).toContain('focus-visible:ring-ink/20')
    expect(focusChrome).not.toContain('ring-accent')
    expect(focusChrome).not.toContain('ring-focus-ring')
  })

  it('inputClassName embeds focusField fragments', () => {
    expect(inputClassName).toContain('focus-visible:border-accent')
    expect(inputClassName).toContain('focus-visible:ring-accent/10')
  })
})
