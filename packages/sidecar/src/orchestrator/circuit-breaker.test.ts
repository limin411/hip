import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from './circuit-breaker.js'

describe('CircuitBreaker', () => {
  it('allows steps within budget', () => {
    const cb = new CircuitBreaker({ maxSteps: 10, maxTokens: 10000, maxNoFileChangeSteps: 5 })
    const result = cb.step(100, true)
    expect(result.action).toBe('continue')
  })

  it('terminates on token budget exhaustion', () => {
    const cb = new CircuitBreaker({ maxTokens: 500 })
    const result = cb.step(600, true)
    expect(result.action).toBe('terminate')
    expect(result.reason).toContain('Token budget exhausted')
  })

  it('terminates on step limit', () => {
    const cb = new CircuitBreaker({ maxSteps: 1 })
    cb.step(10, true)
    const result = cb.step(10, true)
    expect(result.action).toBe('terminate')
    expect(result.reason).toContain('Step limit reached')
  })

  it('warns on no-progress then terminates after maxWarns', () => {
    const cb = new CircuitBreaker({ maxNoFileChangeSteps: 3, maxWarns: 2 })

    // First 3 steps: no file change -> warn
    cb.step(10, false)
    cb.step(10, false)
    const warn1 = cb.step(10, false)
    expect(warn1.action).toBe('warn')

    // Reset stall counter by making a file change
    cb.step(10, true) // resets consecutiveNoFileChange

    // Another 3 no-change -> second warn
    cb.step(10, false)
    cb.step(10, false)
    const warn2 = cb.step(10, false)
    expect(warn2.action).toBe('warn')

    // Third time -> terminate (warnCount >= maxWarns)
    cb.step(10, true) // reset
    cb.step(10, false)
    cb.step(10, false)
    const term = cb.step(10, false)
    expect(term.action).toBe('terminate')
    expect(term.reason).toContain('2 warnings')
  })

  it('file change resets consecutive counter but warn count persists until explicit reset', () => {
    const cb = new CircuitBreaker({ maxNoFileChangeSteps: 2, maxWarns: 2 })

    // First stall -> warn (warnCount = 1)
    cb.step(10, false)
    const w1 = cb.step(10, false)
    expect(w1.action).toBe('warn')
    expect(cb.getSnapshot().warnCount).toBe(1)

    // File change resets consecutiveNoFileChange to 0, but warnCount stays at 1
    cb.step(10, true)
    cb.step(10, true)
    expect(cb.getSnapshot().consecutiveNoFileChange).toBe(0)
    expect(cb.getSnapshot().warnCount).toBe(1)

    // Second stall -> warn (warnCount = 2)
    cb.step(10, false)
    const w2 = cb.step(10, false)
    expect(w2.action).toBe('warn')
    expect(cb.getSnapshot().warnCount).toBe(2)

    // Third stall -> terminate (warnCount 2 >= maxWarns 2)
    cb.step(10, false)
    const term = cb.step(10, false)
    expect(term.action).toBe('terminate')
    expect(term.reason).toContain('2 warnings')
  })

  it('reset() clears all state', () => {
    const cb = new CircuitBreaker()
    cb.step(5000, false)
    cb.step(5000, false)
    cb.reset()
    expect(cb.getSnapshot().steps).toBe(0)
    expect(cb.getSnapshot().totalTokens).toBe(0)
    expect(cb.getSnapshot().consecutiveNoFileChange).toBe(0)
    expect(cb.getSnapshot().warnCount).toBe(0)
    expect(cb.getSnapshot().lastFileChangedAt).toBeNull()
  })
})
