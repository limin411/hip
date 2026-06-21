import { describe, expect, it } from 'vitest'
import {
  shouldPlanComplex,
  shouldReplan,
  buildReplanPrompt,
  decideReplan,
  TurnReplanGuard,
  REPLAN_ERROR_THRESHOLD,
  type PlannerInput,
  type PlannerDecision,
} from './planner.js'

const adaptive = (userMessage: string, toolErrorCount = 0): PlannerInput => ({
  userMessage,
  toolErrorCount,
  planMode: 'adaptive',
})

describe('shouldPlanComplex', () => {
  describe('adaptive mode', () => {
    // Spec test 1: simple task → shouldPlan=false
    it('returns shouldPlan=false for a simple short task', () => {
      const decision = shouldPlanComplex(adaptive('hello'))
      expect(decision.shouldPlan).toBe(false)
      expect(decision.mode).toBe('skip')
      expect(decision.reason.length).toBeGreaterThan(0)
    })

    // Spec test 2: complex task → shouldPlan=true
    it('returns shouldPlan=true for a complex refactor task', () => {
      const decision = shouldPlanComplex(adaptive('refactor the auth module to use JWT'))
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    // Spec test 3: planning keyword match → shouldPlan=true
    it('returns shouldPlan=true when the user says "plan first"', () => {
      const decision = shouldPlanComplex(adaptive('plan first: design the API'))
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    it('returns shouldPlan=true on architecture keyword', () => {
      const decision = shouldPlanComplex(adaptive('review the system architecture for bottlenecks'))
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    it('returns shouldPlan=true on CJK planning keyword', () => {
      const decision = shouldPlanComplex(adaptive('请重构这个模块'))
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    it('returns shouldPlan=true when message references multiple file paths', () => {
      const decision = shouldPlanComplex(adaptive('update src/foo.ts and src/bar.ts'))
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    it('returns shouldPlan=false when message references a single file path', () => {
      const decision = shouldPlanComplex(adaptive('look at src/foo.ts'))
      expect(decision.shouldPlan).toBe(false)
      expect(decision.mode).toBe('skip')
    })

    it('returns shouldPlan=true when message exceeds the length threshold', () => {
      const long = 'a'.repeat(250)
      const decision = shouldPlanComplex(adaptive(long))
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    it('returns shouldPlan=false for an empty message', () => {
      const decision = shouldPlanComplex(adaptive('   '))
      expect(decision.shouldPlan).toBe(false)
      expect(decision.mode).toBe('skip')
    })
  })

  // Spec test 4: plan_mode='never' → always skip
  describe('never mode', () => {
    it('always returns shouldPlan=false regardless of message complexity', () => {
      const input: PlannerInput = {
        userMessage: 'refactor the auth module to use JWT, then design the architecture',
        toolErrorCount: 0,
        planMode: 'never',
      }
      const decision = shouldPlanComplex(input)
      expect(decision.shouldPlan).toBe(false)
      expect(decision.mode).toBe('skip')
    })

    it('skips planning even with multi-path references', () => {
      const input: PlannerInput = {
        userMessage: 'plan first: edit src/a.ts and src/b.ts',
        toolErrorCount: 0,
        planMode: 'never',
      }
      const decision = shouldPlanComplex(input)
      expect(decision.shouldPlan).toBe(false)
    })
  })

  // Spec test 5: plan_mode='always' → always plan
  describe('always mode', () => {
    it('always returns shouldPlan=true even for trivial tasks', () => {
      const input: PlannerInput = { userMessage: 'hello', toolErrorCount: 0, planMode: 'always' }
      const decision = shouldPlanComplex(input)
      expect(decision.shouldPlan).toBe(true)
      expect(decision.mode).toBe('plan')
    })

    it('returns shouldPlan=true even for an empty message', () => {
      const input: PlannerInput = { userMessage: '', toolErrorCount: 0, planMode: 'always' }
      const decision = shouldPlanComplex(input)
      expect(decision.shouldPlan).toBe(true)
    })
  })

  it('every decision carries a non-empty reason', () => {
    const cases: PlannerInput[] = [
      adaptive('hi'),
      adaptive('plan first'),
      { userMessage: 'x', toolErrorCount: 0, planMode: 'always' },
      { userMessage: 'x', toolErrorCount: 0, planMode: 'never' },
    ]
    for (const c of cases) {
      const d: PlannerDecision = shouldPlanComplex(c)
      expect(d.reason.length).toBeGreaterThan(0)
    }
  })
})

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
