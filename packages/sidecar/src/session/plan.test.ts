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

  it('returns true for multi-step keywords', () => {
    expect(shouldPlan('first do this then do that')).toBe(true)
    expect(shouldPlan('步骤 1: create file, 步骤 2: edit file')).toBe(true)
    expect(shouldPlan('plan the refactor')).toBe(true)
  })

  it('returns true when file intent mentions multiple paths', () => {
    expect(shouldPlan('create src/foo.ts and src/bar.ts')).toBe(true)
    expect(shouldPlan('edit packages/a/index.ts and packages/b/index.ts')).toBe(true)
  })

  it('returns false for file intent with a single path', () => {
    expect(shouldPlan('edit src/foo.ts')).toBe(false)
  })

  it('respects forcePlan', () => {
    expect(shouldPlan('hi', { forcePlan: true })).toBe(true)
  })

  it('respects disablePlan', () => {
    expect(shouldPlan('first do this then do that', { disablePlan: true })).toBe(false)
  })

  it('disablePlan overrides forcePlan', () => {
    expect(shouldPlan('hi', { forcePlan: true, disablePlan: true })).toBe(false)
  })
})
