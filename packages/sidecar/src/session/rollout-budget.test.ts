// packages/sidecar/src/session/rollout-budget.test.ts
import { describe, it, expect } from 'vitest'
import { RolloutBudget, formatRolloutReminder, ROLLOUT_BUDGET_THRESHOLDS } from './rollout-budget.js'

describe('RolloutBudget', () => {
  it('is disabled with total 0 and ignores records', () => {
    const b = new RolloutBudget(0)
    expect(b.enabled).toBe(false)
    b.record(1000)
    expect(b.spent).toBe(0)
    expect(b.exhausted()).toBe(false)
    expect(b.pollReminder()).toBeNull()
  })

  it('records spend and tracks remaining', () => {
    const b = new RolloutBudget(10000)
    b.record(4000)
    b.record(1000)
    expect(b.spent).toBe(5000)
    expect(b.remaining()).toBe(5000)
    expect(b.exhausted()).toBe(false)
  })

  it('ignores non-positive and non-finite tokens', () => {
    const b = new RolloutBudget(100)
    b.record(-5)
    b.record(0)
    b.record(Number.NaN)
    expect(b.spent).toBe(0)
  })

  it('fires each threshold exactly once', () => {
    const b = new RolloutBudget(1000)
    // 50%
    b.record(500)
    expect(b.pollReminder()?.threshold).toBe(0.5)
    expect(b.pollReminder()).toBeNull() // no re-fire
    // 80%
    b.record(300)
    expect(b.pollReminder()?.threshold).toBe(0.8)
    // 90%
    b.record(100)
    expect(b.pollReminder()?.threshold).toBe(0.9)
    expect(b.pollReminder()).toBeNull()
    // exhausted
    b.record(200)
    expect(b.exhausted()).toBe(true)
    expect(b.pollReminder()).toBeNull()
  })

  it('thresholds stay in defined order', () => {
    expect(ROLLOUT_BUDGET_THRESHOLDS).toEqual([0.5, 0.8, 0.9])
  })

  it('does not poll reminders when nothing recorded', () => {
    const b = new RolloutBudget(1000)
    expect(b.pollReminder()).toBeNull()
  })
})

describe('formatRolloutReminder', () => {
  it('renders spent/total and convergence advice', () => {
    const text = formatRolloutReminder({ threshold: 0.5, spent: 5000, total: 10000 })
    expect(text).toContain('5000')
    expect(text).toContain('10000')
    expect(text).toContain('50%')
    expect(text).toContain('Converge')
  })
})
