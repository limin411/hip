import { describe, it, expect } from 'vitest'
import { MAX_STEPS, MAX_STEPS_NOTE, recursionLimit } from './loop-control.js'

describe('loop-control', () => {
  it('caps steps at 25 and reserves graph recursion headroom above 3x', () => {
    expect(MAX_STEPS).toBe(25)
    expect(recursionLimit()).toBe(MAX_STEPS * 3 + 10)
  })

  it('the max-steps note tells the model tools are disabled and to answer in text', () => {
    expect(MAX_STEPS_NOTE).toMatch(/maximum/i)
    expect(MAX_STEPS_NOTE).toMatch(/text/i)
  })
})
