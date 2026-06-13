import { describe, it, expect } from 'vitest'
import { roleForName } from './agents.js'

describe('roleForName', () => {
  it('maps known sub-agent names to their role', () => {
    expect(roleForName('planner')).toBe('planner')
    expect(roleForName('coder')).toBe('coder')
    expect(roleForName('reviewer')).toBe('reviewer')
  })
  it('defaults unknown / empty names to supervisor', () => {
    expect(roleForName(undefined)).toBe('supervisor')
    expect(roleForName('researcher')).toBe('supervisor')
    expect(roleForName('')).toBe('supervisor')
  })
})
