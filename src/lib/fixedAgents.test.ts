import { describe, it, expect } from 'vitest'
import { FIXED_AGENTS, FIXED_AGENT_IDS } from './fixedAgents'

describe('FIXED_AGENTS', () => {
  it('contains exactly 3 agents', () => {
    expect(FIXED_AGENTS).toHaveLength(3)
  })

  it('has unique ids', () => {
    const ids = FIXED_AGENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all agents have kind "internal"', () => {
    for (const a of FIXED_AGENTS) {
      expect(a.kind).toBe('internal')
    }
  })

  it('all agents have required fields', () => {
    for (const a of FIXED_AGENTS) {
      expect(a.id).toBeTruthy()
      expect(a.name).toBeTruthy()
      expect(a.description).toBeTruthy()
      expect(a.prompt).toBeTruthy()
      expect(a.enabled).toBe(true)
    }
  })

  it('includes coder, explore, and plan', () => {
    expect(FIXED_AGENT_IDS).toEqual(['coder', 'explore', 'plan'])
  })

})
