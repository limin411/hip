import { describe, expect, it } from 'vitest'
import {
  shouldReplan,
  buildReplanPrompt,
  decideReplan,
  TurnReplanGuard,
  REPLAN_ERROR_THRESHOLD,
} from './planner.js'

describe('shouldReplan', () => {
  // Spec test 6: 2 tool errors → true
  it('returns true when toolErrorCount is at the threshold (2)', () => {
    expect(shouldReplan(REPLAN_ERROR_THRESHOLD)).toBe(true)
  })

  // Spec test 7: 1 tool error → false
  it('returns false when toolErrorCount is below the threshold (1)', () => {
    expect(shouldReplan(1)).toBe(false)
  })

  it('returns true when toolErrorCount exceeds the threshold', () => {
    expect(shouldReplan(5)).toBe(true)
  })

  it('returns false for zero tool errors', () => {
    expect(shouldReplan(0)).toBe(false)
  })
})

describe('buildReplanPrompt', () => {
  // Spec test 8: meaningful system message
  it('produces a meaningful system message with errors and a replan directive', () => {
    const prompt = buildReplanPrompt([
      'write_file failed: ENOENT src/foo.ts',
      'edit_file failed: range not found in src/bar.ts',
    ])
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(50)
    expect(prompt).toContain('write_file failed: ENOENT src/foo.ts')
    expect(prompt).toContain('edit_file failed: range not found in src/bar.ts')
    // Directive language instructing the agent to revise/re-plan
    expect(prompt.toLowerCase()).toMatch(/revise|re-pl?an|fresh plan/)
  })

  it('returns a non-empty string for an empty error list', () => {
    const prompt = buildReplanPrompt([])
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('truncates long error lists with an overflow indicator', () => {
    const errors = Array.from({ length: 10 }, (_, i) => `error ${i + 1}`)
    const prompt = buildReplanPrompt(errors)
    expect(prompt).toContain('error 1')
    expect(prompt).toContain('error 5')
    expect(prompt).toContain('more error')
  })
})

describe('TurnReplanGuard', () => {
  it('canReplan is true on a fresh guard', () => {
    const guard = new TurnReplanGuard()
    expect(guard.canReplan()).toBe(true)
    expect(guard.hasReplanned).toBe(false)
  })

  it('canReplan is false after markReplanned', () => {
    const guard = new TurnReplanGuard()
    guard.markReplanned()
    expect(guard.canReplan()).toBe(false)
    expect(guard.hasReplanned).toBe(true)
  })
})

describe('decideReplan', () => {
  it('returns replan=false and no prompt when guard has already replanned this turn', () => {
    const guard = new TurnReplanGuard()
    guard.markReplanned()
    const decision = decideReplan(['e1', 'e2'], guard)
    expect(decision.replan).toBe(false)
    expect(decision.prompt).toBeNull()
  })

  it('returns replan=false when error count is below threshold', () => {
    const guard = new TurnReplanGuard()
    const decision = decideReplan(['only-error'], guard)
    expect(decision.replan).toBe(false)
    expect(decision.prompt).toBeNull()
    expect(guard.hasReplanned).toBe(false)
  })

  it('returns replan=true with a prompt and marks the guard consumed', () => {
    const guard = new TurnReplanGuard()
    const decision = decideReplan(['err one', 'err two'], guard)
    expect(decision.replan).toBe(true)
    expect(decision.prompt).not.toBeNull()
    expect(decision.prompt).toContain('err one')
    expect(guard.hasReplanned).toBe(true)
  })

  it('enforces max one replan per turn across repeated calls', () => {
    const guard = new TurnReplanGuard()
    const first = decideReplan(['a', 'b'], guard)
    const second = decideReplan(['c', 'd'], guard)
    expect(first.replan).toBe(true)
    expect(second.replan).toBe(false)
    expect(second.prompt).toBeNull()
  })
})
