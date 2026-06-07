import { describe, it, expect } from 'vitest'
import { roleForName, agentIdForRole, SUBAGENTS, SUPERVISOR_PROMPT } from './agents.js'

describe('roleForName', () => {
  it('maps planner/coder/reviewer to themselves', () => {
    expect(roleForName('planner')).toBe('planner')
    expect(roleForName('coder')).toBe('coder')
    expect(roleForName('reviewer')).toBe('reviewer')
  })

  it('maps undefined to supervisor', () => {
    expect(roleForName(undefined)).toBe('supervisor')
  })

  it('maps unknown names to supervisor', () => {
    expect(roleForName('researcher')).toBe('supervisor')
    expect(roleForName('')).toBe('supervisor')
    expect(roleForName('PLANNER')).toBe('supervisor')
  })
})

describe('agentIdForRole', () => {
  it('returns the role string as the agent id', () => {
    expect(agentIdForRole('supervisor')).toBe('supervisor')
    expect(agentIdForRole('planner')).toBe('planner')
    expect(agentIdForRole('coder')).toBe('coder')
    expect(agentIdForRole('reviewer')).toBe('reviewer')
  })
})

describe('SUBAGENTS config', () => {
  it('defines the three coding subagents with required fields', () => {
    expect(SUBAGENTS.map((s) => s.name)).toEqual(['planner', 'coder', 'reviewer'])
    for (const sub of SUBAGENTS) {
      expect(sub.description.length).toBeGreaterThan(0)
      expect(sub.systemPrompt.length).toBeGreaterThan(0)
    }
  })

  it('every subagent name resolves to a non-supervisor role', () => {
    for (const sub of SUBAGENTS) {
      expect(roleForName(sub.name)).not.toBe('supervisor')
      expect(roleForName(sub.name)).toBe(sub.name)
    }
  })

  it('supervisor prompt forces use of the task tool', () => {
    expect(SUPERVISOR_PROMPT).toContain('task')
  })
})
