import { describe, it, expect } from 'vitest'
import { resolveGate, listGates, registerGate } from './index.js'
import type { VerificationGate } from '../verification-gate.js'

describe('Gate registry', () => {
  it('resolves all built-in gates', () => {
    for (const kind of ['typecheck', 'lint', 'test', 'script']) {
      expect(resolveGate(kind as any)).toBeDefined()
      expect(resolveGate(kind as any).kind).toBe(kind)
    }
  })

  it('throws on unknown gate', () => {
    expect(() => resolveGate('unknown' as any)).toThrow('Unknown gate kind')
  })

  it('supports custom gate registration', () => {
    const custom: VerificationGate = {
      kind: 'custom-check',
      description: 'A custom check',
      async run(ctx) {
        return { passed: true, failures: [], suggestions: [], durationMs: 0 }
      },
    }
    registerGate(custom)
    expect(resolveGate('custom-check')).toBe(custom)
  })

  it('listGates includes all registered gates', () => {
    const gates = listGates()
    expect(gates).toContain('typecheck')
    expect(gates).toContain('lint')
    expect(gates).toContain('test')
    expect(gates).toContain('script')
  })
})
