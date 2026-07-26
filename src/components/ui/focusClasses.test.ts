// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { focusChrome, focusField, focusFieldWithin } from './focusClasses'
import { inputClassName } from './Input'

describe('focusClasses allowlist', () => {
  it('focusField is outline-only (no tinted chrome)', () => {
    expect(focusField).toBe('focus-visible:outline-none')
    expect(focusField).not.toContain('border-accent')
    expect(focusField).not.toContain('ring-accent')
    expect(focusField).not.toContain('ring-ink')
    expect(focusField).not.toContain('ring-focus-ring')
  })

  it('focusFieldWithin has no focus chrome', () => {
    expect(focusFieldWithin).toBe('')
    expect(focusFieldWithin).not.toContain('border-accent')
    expect(focusFieldWithin).not.toContain('ring-')
  })

  it('focusChrome is quiet ink ring only', () => {
    expect(focusChrome).toContain('focus-visible:ring-2')
    expect(focusChrome).toContain('focus-visible:ring-ink/20')
    expect(focusChrome).not.toContain('ring-accent')
    expect(focusChrome).not.toContain('ring-focus-ring')
  })

  it('inputClassName embeds focusField fragments', () => {
    expect(inputClassName).toContain('focus-visible:outline-none')
    expect(inputClassName).not.toContain('border-accent')
    expect(inputClassName).not.toContain('ring-accent')
  })
})
