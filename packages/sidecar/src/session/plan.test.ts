import { describe, expect, it } from 'vitest'
import { shouldPlan } from './plan.js'

describe('shouldPlan', () => {
  it('returns false for short simple questions', () => {
    expect(shouldPlan('what is 2+2?')).toBe(false)
  })

  it('returns true for long messages', () => {
    const longMessage = 'a'.repeat(201)
    expect(shouldPlan(longMessage)).toBe(true)
  })

  it('respects forcePlan', () => {
    expect(shouldPlan('hi', { forcePlan: true })).toBe(true)
  })

  it('respects disablePlan', () => {
    expect(shouldPlan('a'.repeat(201), { disablePlan: true })).toBe(false)
  })

  it('disablePlan overrides forcePlan', () => {
    expect(shouldPlan('hi', { forcePlan: true, disablePlan: true })).toBe(false)
  })

  it('returns false for messages at exactly 200 chars', () => {
    expect(shouldPlan('a'.repeat(200))).toBe(false)
  })

  it('returns false for messages under 200 chars with old plan keywords (keyword detection removed)', () => {
    expect(shouldPlan('first do this then do that')).toBe(false)
    expect(shouldPlan('plan the refactor')).toBe(false)
  })
})
