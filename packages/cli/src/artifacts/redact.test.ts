import { describe, it, expect } from 'vitest'
import { redactSecrets } from './redact.js'

describe('redactSecrets', () => {
  it('redacts sk- keys', () => {
    expect(redactSecrets('key=sk-abcdefghijklmnopqrstuvwxyz')).toContain('***')
    expect(redactSecrets('key=sk-abcdefghijklmnopqrstuvwxyz')).not.toContain('sk-abcdefgh')
  })

  it('redacts HIP_MODEL env style', () => {
    const s = redactSecrets('HIP_MODEL_DEEPSEEK_API_KEY=sk-secretvaluehere')
    expect(s).toMatch(/HIP_MODEL_DEEPSEEK_API_KEY=\*\*\*/)
  })

  it('redacts Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).toMatch(/Bearer \*\*\*/)
  })

  it('redacts JSON api_key fields', () => {
    const s = redactSecrets('{"api_key":"supersecretvalue"}')
    expect(s).toContain('***')
    expect(s).not.toContain('supersecretvalue')
  })
})
