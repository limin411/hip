import { describe, expect, it } from 'vitest'
import { sanitizeKnowledgeLinkHref } from './linkSanitize'

describe('sanitizeKnowledgeLinkHref', () => {
  it('allows https and relative', () => {
    expect(sanitizeKnowledgeLinkHref('https://example.com')).toBe(
      'https://example.com',
    )
    expect(sanitizeKnowledgeLinkHref('/docs/a')).toBe('/docs/a')
    expect(sanitizeKnowledgeLinkHref('./x')).toBe('./x')
    expect(sanitizeKnowledgeLinkHref('#anchor')).toBe('#anchor')
  })

  it('rejects javascript and data', () => {
    expect(sanitizeKnowledgeLinkHref('javascript:alert(1)')).toBeNull()
    expect(sanitizeKnowledgeLinkHref('data:text/html,hi')).toBeNull()
  })

  it('rejects empty', () => {
    expect(sanitizeKnowledgeLinkHref('  ')).toBeNull()
  })
})
