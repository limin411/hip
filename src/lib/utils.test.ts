import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('dedupes conflicting tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })

  // Regression: custom font-size tokens (text-body/meta/…) must not be mistaken for text
  // colors, or tailwind-merge silently strips a real color merged alongside them.
  it('keeps a text color when merged with a custom font-size token', () => {
    expect(cn('text-white', 'text-body')).toBe('text-white text-body')
    expect(cn('bg-accent text-white', 'h-8 px-3 text-body')).toContain('text-white')
    expect(cn('text-ink', 'text-meta')).toContain('text-ink')
    expect(cn('text-page', 'text-ink')).toBe('text-page text-ink')
  })

  it('still treats two custom font-size tokens as conflicting (last wins)', () => {
    expect(cn('text-body', 'text-prose')).toBe('text-prose')
  })
})
