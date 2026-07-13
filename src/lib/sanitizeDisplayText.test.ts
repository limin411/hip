import { describe, it, expect } from 'vitest'
import { hasInternalMarkup, sanitizeDisplayText } from './sanitizeDisplayText'

const DSML_BLOCK = [
  'Let me check files.',
  '<｜｜DSML｜｜tool_calls>',
  '<｜｜DSML｜｜invoke name="read_file">',
  '<｜｜DSML｜｜parameter name="path" string="true">a.java</｜｜DSML｜｜parameter>',
  '</｜｜DSML｜｜invoke>',
  '</｜｜DSML｜｜tool_calls>',
].join('\n')

describe('sanitizeDisplayText', () => {
  it('passes clean prose through', () => {
    expect(sanitizeDisplayText('hello world')).toBe('hello world')
  })

  it('strips prose + DSML block, keeps prose', () => {
    const out = sanitizeDisplayText(DSML_BLOCK)
    expect(out).toContain('Let me check files')
    expect(out).not.toMatch(/DSML/i)
    expect(out).not.toContain('tool_calls')
    expect(out).not.toContain('read_file')
  })

  it('returns empty when only DSML', () => {
    const only = '<｜｜DSML｜｜tool_calls>\n</｜｜DSML｜｜tool_calls>'
    expect(sanitizeDisplayText(only)).toBe('')
  })

  it('handles null/undefined', () => {
    expect(sanitizeDisplayText(null)).toBe('')
    expect(sanitizeDisplayText(undefined)).toBe('')
  })

  it('strips ASCII ||DSML|| markers', () => {
    const dirty = 'hi <||DSML||tool_calls>\nfoo\n</||DSML||tool_calls>'
    const out = sanitizeDisplayText(dirty)
    expect(out).not.toMatch(/DSML/i)
    expect(out).toContain('hi')
  })

  it('hasInternalMarkup detects DSML', () => {
    expect(hasInternalMarkup(DSML_BLOCK)).toBe(true)
    expect(hasInternalMarkup('plain')).toBe(false)
  })
})
