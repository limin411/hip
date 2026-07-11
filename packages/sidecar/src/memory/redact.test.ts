import { describe, it, expect } from 'vitest'
import { redactSecrets } from './redact.js'

describe('redactSecrets', () => {
  it('redacts OpenAI-like sk- keys', () => {
    const text = 'key is sk-proj-abcdefghijklmnopqrstuvwxyz123456 use it'
    expect(redactSecrets(text)).toContain('[REDACTED_SECRET]')
    expect(redactSecrets(text)).not.toContain('sk-proj-')
  })

  it('redacts Bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'
    const out = redactSecrets(text)
    expect(out).toMatch(/Bearer \[REDACTED_SECRET\]/)
    expect(out).not.toContain('eyJhbGci')
  })

  it('redacts PEM private key blocks', () => {
    const pem = `before
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGFw
-----END RSA PRIVATE KEY-----
after`
    const out = redactSecrets(pem)
    expect(out).toContain('[REDACTED_SECRET]')
    expect(out).not.toContain('BEGIN RSA PRIVATE KEY')
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  it('redacts long hex secrets', () => {
    const hex = 'a'.repeat(40)
    const text = `token ${hex} ok`
    const out = redactSecrets(text)
    expect(out).toContain('[REDACTED_SECRET]')
    expect(out).not.toContain(hex)
  })

  it('redacts api_key= and password= values', () => {
    const text = 'api_key=supersecretvalue123 password: hunter2password'
    const out = redactSecrets(text)
    expect(out).toMatch(/api_key=\[REDACTED_SECRET\]/i)
    expect(out).toMatch(/password:\s*\[REDACTED_SECRET\]/i)
    expect(out).not.toContain('supersecretvalue123')
    expect(out).not.toContain('hunter2password')
  })

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('prefer TypeScript strict mode')).toBe('prefer TypeScript strict mode')
  })
})
