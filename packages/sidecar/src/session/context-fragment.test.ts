import { describe, it, expect } from 'vitest'
import { FragmentRegistry } from './context-fragment.js'
import type { ContextFragment, FragmentState } from './context-fragment.js'

/** Convenience helper: create a minimal fragment for tests. */
function makeFragment(
  id: string,
  opts?: {
    role?: 'developer' | 'user' | 'system'
    active?: boolean | ((state: FragmentState) => boolean)
    renderText?: string
    tokens?: number
  },
): ContextFragment {
  const raw = opts?.active
  const activeFn: (state: FragmentState) => boolean =
    typeof raw === 'function' ? raw : () => raw ?? true
  return {
    id,
    role: opts?.role ?? 'system',
    isActive: activeFn,
    render: () => opts?.renderText ?? `[${id}]`,
    estimatedTokens: () => opts?.tokens ?? 10,
  }
}

const emptyState: FragmentState = {}

describe('FragmentRegistry', () => {
  // ── Test 1: assemble concatenates output and sums tokens ───────────────────
  it('assembles 3 registered fragments with correct text and token count', () => {
    const reg = new FragmentRegistry()
    reg.register(makeFragment('a', { renderText: 'Hello', tokens: 5 }))
    reg.register(makeFragment('b', { renderText: 'World', tokens: 7 }))
    reg.register(makeFragment('c', { renderText: '!', tokens: 3 }))

    const result = reg.assemble(emptyState)

    expect(result.text).toBe('Hello\n\nWorld\n\n!')
    expect(result.tokens).toBe(15)
    expect(result.fragments).toHaveLength(3)
    expect(result.fragments.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  // ── Test 2: duplicate id throws ───────────────────────────────────────────
  it('throws when registering a fragment with a duplicate id', () => {
    const reg = new FragmentRegistry()
    reg.register(makeFragment('dup'))

    expect(() => reg.register(makeFragment('dup'))).toThrow(
      'Duplicate fragment id: dup',
    )
  })

  // ── Test 3: inactive fragments excluded ────────────────────────────────────
  it('excludes inactive fragments from assembly', () => {
    const reg = new FragmentRegistry()
    reg.register(makeFragment('always', { active: true }))
    reg.register(makeFragment('never', { active: false }))
    reg.register(makeFragment('also-always', { active: true }))

    const result = reg.assemble(emptyState)

    expect(result.fragments).toHaveLength(2)
    expect(result.fragments.map((f) => f.id)).toEqual(['always', 'also-always'])
    expect(result.text).toBe('[always]\n\n[also-always]')
    expect(result.tokens).toBe(20)
  })

  // ── Test 4: fragments render in registration order ─────────────────────────
  it('returns fragments and their output in registration order', () => {
    const reg = new FragmentRegistry()
    // Insert in reverse alphabetical order
    reg.register(makeFragment('c', { renderText: 'third' }))
    reg.register(makeFragment('b', { renderText: 'second' }))
    reg.register(makeFragment('a', { renderText: 'first' }))

    const result = reg.assemble(emptyState)

    expect(result.fragments.map((f) => f.id)).toEqual(['c', 'b', 'a'])
    expect(result.text).toBe('third\n\nsecond\n\nfirst')
  })

  // ── Bonus: state-dependent activation works ────────────────────────────────
  it('uses FragmentState for activation decisions', () => {
    const reg = new FragmentRegistry()
    reg.register(
      makeFragment('budget-alert', {
        active: (s) => (s.tokenBudgetPercent ?? 0) > 80,
        renderText: 'WARNING: token budget nearly exhausted',
        tokens: 8,
      }),
    )

    // Below threshold → inactive
    const low = reg.assemble({ tokenBudgetPercent: 50 })
    expect(low.fragments).toHaveLength(0)
    expect(low.text).toBe('')
    expect(low.tokens).toBe(0)

    // Above threshold → active
    const high = reg.assemble({ tokenBudgetPercent: 90 })
    expect(high.fragments).toHaveLength(1)
    expect(high.text).toBe('WARNING: token budget nearly exhausted')
    expect(high.tokens).toBe(8)
  })

  // ── Bonus: getActiveFragments matches assemble's fragments list ────────────
  it('getActiveFragments returns same fragments as assemble', () => {
    const reg = new FragmentRegistry()
    reg.register(makeFragment('x'))
    reg.register(makeFragment('y', { active: false }))
    reg.register(makeFragment('z'))

    const active = reg.getActiveFragments(emptyState)
    const assembled = reg.assemble(emptyState)

    expect(active).toEqual(assembled.fragments)
  })
})
