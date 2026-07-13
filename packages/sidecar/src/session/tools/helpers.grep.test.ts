import { describe, it, expect } from 'vitest'
import { compileGrepPattern } from './helpers.js'

describe('compileGrepPattern', () => {
  it('strips leading (?i) and matches case-insensitively', () => {
    const r = compileGrepPattern('(?i)zuolin|zuo_lin|zuo-lin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.test('ZuolinConfig')).toBe(true)
    expect(r.re.test('zuolin')).toBe(true)
    expect(r.notes.some((n) => n.includes('(?i)'))).toBe(true)
  })

  it('honors caseInsensitive without inline flags', () => {
    const r = compileGrepPattern('zuolin', true)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.test('Zuolin')).toBe(true)
  })

  it('keeps case-sensitive match by default', () => {
    const r = compileGrepPattern('zuolin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.test('zuolin')).toBe(true)
    expect(r.re.test('Zuolin')).toBe(false)
  })

  it('returns a hint on invalid regex', () => {
    const r = compileGrepPattern('(unclosed')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/invalid regex/i)
    expect(r.error).toMatch(/caseInsensitive/i)
  })

  it('maps (?im) to JS flags', () => {
    const r = compileGrepPattern('(?im)^foo')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.flags).toContain('i')
    expect(r.re.flags).toContain('m')
  })
})
