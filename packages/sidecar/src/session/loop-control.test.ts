import { describe, it, expect } from 'vitest'
import { MAX_STEPS, MAX_STEPS_NOTE, recursionLimit, CHILD_MAX_STEPS } from './loop-control.js'

describe('loop-control', () => {
  it('caps steps at 25 and reserves graph recursion headroom above 3x', () => {
    expect(MAX_STEPS).toBe(25)
    expect(recursionLimit()).toBe(MAX_STEPS * 3 + 10)
  })

  it('recursionLimit accepts a custom maxSteps for sub-agents', () => {
    expect(CHILD_MAX_STEPS).toBe(15)
    expect(recursionLimit(CHILD_MAX_STEPS)).toBe(CHILD_MAX_STEPS * 3 + 10)
    expect(recursionLimit(5)).toBe(25)
  })

  it('the max-steps note tells the model tools are disabled and to answer in text', () => {
    expect(MAX_STEPS_NOTE).toMatch(/maximum/i)
    expect(MAX_STEPS_NOTE).toMatch(/text/i)
  })
})
