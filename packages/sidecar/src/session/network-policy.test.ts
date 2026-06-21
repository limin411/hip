import { describe, it, expect } from 'vitest'
import {
  NetworkPolicy,
  type NetworkPolicyConfig,
  type NetworkPolicyOpts,
} from './network-policy.js'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NetworkPolicy', () => {
  // ── 1. allowed domain → { allowed: true } ──────────────────────────────────
  it('allows an exact-match domain in the allowlist', () => {
    const policy = new NetworkPolicy({ allowlist: ['api.openai.com'] })
    const r = policy.checkUrl('https://api.openai.com/v1/chat')
    expect(r.allowed).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  // ── 2. denied domain → { allowed: false, reason } ──────────────────────────
  it('blocks a denylisted domain with the spec-defined reason', () => {
    const policy = new NetworkPolicy({ denylist: ['evil.com'] })
    const r = policy.checkUrl('https://evil.com/path')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('Domain is in denylist')
  })

  // ── 3. wildcard match: *.github.com → api.github.com / raw.github.com ──────
  it('matches a wildcard allowlist entry against subdomains', () => {
    const policy = new NetworkPolicy({ allowlist: ['*.github.com'] })
    expect(policy.checkUrl('https://api.github.com/').allowed).toBe(true)
    expect(policy.checkUrl('https://raw.github.com/').allowed).toBe(true)
  })

  // ── 4. wildcard miss: *.github.com vs evil.com → blocked ───────────────────
  it('blocks a domain that does not match any wildcard in the allowlist', () => {
    const policy = new NetworkPolicy({ allowlist: ['*.github.com'] })
    const r = policy.checkUrl('https://evil.com/')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/not in allowlist|allowlist/i)
  })

  // ── 5. denylist precedence over allowlist ──────────────────────────────────
  it('blocks a domain present in both allowlist and denylist (denylist wins)', () => {
    const policy = new NetworkPolicy({
      allowlist: ['github.com'],
      denylist: ['github.com'],
    })
    const r = policy.checkUrl('https://github.com/')
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('Domain is in denylist')
  })

  // ── 6. rate limit: 11th request in same minute → blocked ───────────────────
  it('blocks the request that exceeds maxRequestsPerMinute within one window', () => {
    const policy = new NetworkPolicy({ maxRequestsPerMinute: 10 })
    for (let i = 0; i < 10; i++) {
      const r = policy.checkRateLimit('sess-A')
      expect(r.allowed).toBe(true)
    }
    const blocked = policy.checkRateLimit('sess-A')
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toMatch(/rate/i)
  })

  // ── 7. rate limit reset: after 60s window → counter resets ─────────────────
  it('resets the per-session counter after the 60-second window elapses', () => {
    let now = 1_000_000
    const opts: NetworkPolicyOpts = { now: () => now }
    const policy = new NetworkPolicy({ maxRequestsPerMinute: 10 }, opts)
    for (let i = 0; i < 10; i++) policy.checkRateLimit('sess-R')
    expect(policy.checkRateLimit('sess-R').allowed).toBe(false)

    now += 60_000 + 1 // cross the window boundary
    const after = policy.checkRateLimit('sess-R')
    expect(after.allowed).toBe(true)
  })

  // ── 8. no config → default allow all https ─────────────────────────────────
  it('allows any https URL when constructed with no config', () => {
    const policy = new NetworkPolicy()
    expect(policy.checkUrl('https://api.openai.com/').allowed).toBe(true)
    expect(policy.checkUrl('https://example.com/path?q=1').allowed).toBe(true)
  })

  // ── 9. response size cap returned correctly (10MB default) ─────────────────
  it('returns the default 10MB response size cap when unset', () => {
    const policy = new NetworkPolicy()
    expect(policy.getResponseSizeCap()).toBe(10 * 1024 * 1024)
  })

  it('honours a custom maxResponseBytes', () => {
    const policy = new NetworkPolicy({ maxResponseBytes: 1024 })
    expect(policy.getResponseSizeCap()).toBe(1024)
  })

  // ── 10. invalid URL → blocked ──────────────────────────────────────────────
  it('rejects an unparseable URL', () => {
    const policy = new NetworkPolicy()
    const r = policy.checkUrl('not-a-url')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/invalid/i)
  })

  // ── 11. allowlist with mixed exact + wildcard ──────────────────────────────
  it('allows a domain matching either an exact or wildcard entry', () => {
    const policy = new NetworkPolicy({
      allowlist: ['api.openai.com', '*.github.com'],
    })
    expect(policy.checkUrl('https://api.openai.com/').allowed).toBe(true)
    expect(policy.checkUrl('https://api.github.com/').allowed).toBe(true)
    expect(policy.checkUrl('https://api.openai.com.evil.com/').allowed).toBe(false)
  })

  // ── 12. wildcard does NOT match the bare apex domain ───────────────────────
  it('does not match *.github.com against the bare github.com apex', () => {
    const policy = new NetworkPolicy({ allowlist: ['*.github.com'] })
    expect(policy.checkUrl('https://github.com/').allowed).toBe(false)
  })

  // ── 13. rate limit is per-session isolated ─────────────────────────────────
  it('counts rate-limit hits independently per session id', () => {
    const policy = new NetworkPolicy({ maxRequestsPerMinute: 2 })
    expect(policy.checkRateLimit('sess-1').allowed).toBe(true)
    expect(policy.checkRateLimit('sess-1').allowed).toBe(true)
    expect(policy.checkRateLimit('sess-1').allowed).toBe(false)
    // a fresh session has its own budget
    expect(policy.checkRateLimit('sess-2').allowed).toBe(true)
  })

  // ── 14. updateConfig merges partial updates ────────────────────────────────
  it('merges a partial update into the active config', () => {
    const policy = new NetworkPolicy({ allowlist: ['a.com'] })
    expect(policy.checkUrl('https://a.com/').allowed).toBe(true)
    expect(policy.checkUrl('https://b.com/').allowed).toBe(false)

    policy.updateConfig({ allowlist: ['b.com'] })
    expect(policy.checkUrl('https://a.com/').allowed).toBe(false)
    expect(policy.checkUrl('https://b.com/').allowed).toBe(true)
  })

  it('preserves unchanged fields across a partial update', () => {
    const policy = new NetworkPolicy({ denylist: ['x.com'], maxResponseBytes: 2048 })
    policy.updateConfig({ allowlist: ['y.com'] })
    // denylist + size cap untouched
    expect(policy.checkUrl('https://x.com/').allowed).toBe(false)
    expect(policy.getResponseSizeCap()).toBe(2048)
    // allowlist now active
    expect(policy.checkUrl('https://y.com/').allowed).toBe(true)
  })

  // ── 15. default maxRequestsPerMinute is 10 ─────────────────────────────────
  it('applies the default 10 req/min when maxRequestsPerMinute is unset', () => {
    const policy = new NetworkPolicy()
    for (let i = 0; i < 10; i++) {
      expect(policy.checkRateLimit('s').allowed).toBe(true)
    }
    expect(policy.checkRateLimit('s').allowed).toBe(false)
  })

  // ── 16. empty-string allowlist acts as "no allowlist" (allow all) ───────────
  it('treats an empty allowlist array as "allow all"', () => {
    const policy = new NetworkPolicy({ allowlist: [] })
    expect(policy.checkUrl('https://anything.example/').allowed).toBe(true)
  })
})
