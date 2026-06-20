import { describe, it, expect } from 'vitest'
import { keyFor, SessionApprovalCache } from './approval-cache.js'

// ---------------------------------------------------------------------------
// keyFor
// ---------------------------------------------------------------------------
describe('keyFor', () => {
  it('produces a tool-scope key when args is undefined', () => {
    expect(keyFor('run_script', undefined)).toBe('tool:run_script')
  })

  it('produces a tool-scope key when args is empty', () => {
    expect(keyFor('run_script', {})).toBe('tool:run_script')
  })

  it('produces a tool+args scope key when args has entries', () => {
    const k = keyFor('run_script', { command: 'ls' })
    expect(k.startsWith('tool+args:run_script:')).toBe(true)
    expect(k.length).toBeGreaterThan('tool+args:run_script:'.length)
  })

  it('is stable across key reordering', () => {
    const a = keyFor('t', { b: 1, a: 2 })
    const b = keyFor('t', { a: 2, b: 1 })
    expect(a).toBe(b)
  })

  it('is distinct on value change', () => {
    const a = keyFor('t', { x: 1 })
    const b = keyFor('t', { x: 2 })
    expect(a).not.toBe(b)
  })

  it('tool vs tool+args scope produces different keys', () => {
    const toolKey = keyFor('t', undefined)
    const argsKey = keyFor('t', { a: 1 })
    expect(toolKey).not.toBe(argsKey)
  })

  it('handles nested objects stably', () => {
    const a = keyFor('t', { opts: { b: 1, a: 2 } })
    const b = keyFor('t', { opts: { a: 2, b: 1 } })
    expect(a).toBe(b)
  })

  it('omits undefined values so keys stay stable', () => {
    const a = keyFor('t', { a: 1 })
    const b = keyFor('t', { a: 1, b: undefined })
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// SessionApprovalCache
// ---------------------------------------------------------------------------
describe('SessionApprovalCache', () => {
  function fresh(): SessionApprovalCache {
    return new SessionApprovalCache()
  }

  describe('set + lookup', () => {
    it('caches allow_always and returns allow', () => {
      const c = fresh()
      c.set('run_script', undefined, { kind: 'allow_always' })
      expect(c.lookup('run_script', undefined)).toBe('allow')
    })

    it('caches reject_always and returns reject', () => {
      const c = fresh()
      c.set('run_script', undefined, { kind: 'reject_always' })
      expect(c.lookup('run_script', undefined)).toBe('reject')
    })

    it('does not cache allow_once', () => {
      const c = fresh()
      c.set('run_script', undefined, { kind: 'allow_once' })
      expect(c.lookup('run_script', undefined)).toBeUndefined()
    })

    it('does not cache reject_once', () => {
      const c = fresh()
      c.set('run_script', undefined, { kind: 'reject_once' })
      expect(c.lookup('run_script', undefined)).toBeUndefined()
    })

    it('does not cache cancelled decisions', () => {
      const c = fresh()
      c.set('run_script', undefined, { cancelled: true })
      expect(c.lookup('run_script', undefined)).toBeUndefined()
    })

    it('last write wins for the same key', () => {
      const c = fresh()
      c.set('t', { x: 1 }, { kind: 'allow_always' })
      c.set('t', { x: 1 }, { kind: 'reject_always' })
      expect(c.lookup('t', { x: 1 })).toBe('reject')
    })
  })

  describe('scope cascading', () => {
    it('tool-scope cache applies to any args via fallback', () => {
      const c = fresh()
      c.set('run_script', undefined, { kind: 'allow_always' })
      expect(c.lookup('run_script', { command: 'ls' })).toBe('allow')
      expect(c.lookup('run_script', { command: 'pwd' })).toBe('allow')
    })

    it('tool+args scope takes priority over tool scope', () => {
      const c = fresh()
      // General: allow all run_script calls
      c.set('run_script', undefined, { kind: 'allow_always' })
      // Specific: reject this dangerous command
      c.set('run_script', { command: 'rm -rf /' }, { kind: 'reject_always' })

      expect(c.lookup('run_script', { command: 'rm -rf /' })).toBe('reject')
      expect(c.lookup('run_script', { command: 'ls' })).toBe('allow')
      expect(c.lookup('run_script', undefined)).toBe('allow')
    })

    it('tool-scope reject is overridden by tool+args allow', () => {
      const c = fresh()
      c.set('run_script', undefined, { kind: 'reject_always' })
      c.set('run_script', { command: 'npm test' }, { kind: 'allow_always' })

      expect(c.lookup('run_script', { command: 'npm test' })).toBe('allow')
      expect(c.lookup('run_script', { command: 'rm x' })).toBe('reject')
    })

    it('empty args lookup uses tool-scope only', () => {
      const c = fresh()
      c.set('t', undefined, { kind: 'allow_always' })
      // {} is treated as tool-scope (no specific args)
      expect(c.lookup('t', {})).toBe('allow')
    })
  })

  describe('clear', () => {
    it('drops all entries', () => {
      const c = fresh()
      c.set('a', undefined, { kind: 'allow_always' })
      c.set('b', { x: 1 }, { kind: 'reject_always' })
      c.clear()
      expect(c.lookup('a', undefined)).toBeUndefined()
      expect(c.lookup('b', { x: 1 })).toBeUndefined()
    })
  })
})
