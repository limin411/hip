import { describe, it, expect } from 'vitest'
import { safeErrorMessage } from './error.js'

describe('safeErrorMessage', () => {
  it('redacts standard sk- keys', () => {
    const input = 'Error: invalid key sk-abc123def456ghi789jkl01234567890'
    const result = safeErrorMessage(input)
    expect(result).not.toContain('sk-abc123')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts hyphenated OpenAI key shapes (sk-proj-, sk-admin-, sk-svcacct-)', () => {
    const cases = [
      'Error: key is sk-proj-abc12345678901234567890',
      'Error: key is sk-admin-xyz98765432109876543210',
      'Error: key is sk-svcacct-def456ghi012jkl345mno67890',
    ]
    for (const input of cases) {
      const result = safeErrorMessage(input)
      expect(result).not.toContain('sk-')
      expect(result).toContain('[REDACTED]')
    }
  })

  it('redacts api_key assignments', () => {
    const result = safeErrorMessage('api_key=sk-abc123def456ghi789jkl01234567890')
    expect(result).not.toContain('abc123')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens', () => {
    const result = safeErrorMessage('Authorization: Bearer abc123def456ghi789jkl01234567890 failed')
    expect(result).not.toContain('abc123')
    expect(result).toContain('[REDACTED]')
  })

  it('does not redact short non-key strings', () => {
    const input = 'Error: something went wrong with task-123'
    const result = safeErrorMessage(input)
    expect(result).toBe(input)
  })

  it('handles non-Error values', () => {
    expect(safeErrorMessage(42)).toBe('42')
    expect(safeErrorMessage(null)).toBe('null')
    expect(safeErrorMessage(undefined)).toBe('undefined')
  })
})
