import { describe, it, expect } from 'vitest'
import { splitAgents } from './SubAgentCard.js'

describe('splitAgents', () => {
  it('separates supervisor (flat) from nested sub-agents', () => {
    const agents = [
      { agentId: 'supervisor', role: 'supervisor', parentAgentId: undefined },
      { agentId: 'subagent-1', role: 'subagent', parentAgentId: 'supervisor' },
    ] as any
    const { flat, nested } = splitAgents(agents)
    expect(flat.map((a: any) => a.agentId)).toEqual(['supervisor'])
    expect(nested.map((a: any) => a.agentId)).toEqual(['subagent-1'])
  })

  it('nests child runs by parentAgentId regardless of concrete role', () => {
    const agents = [
      { agentId: 'supervisor', role: 'supervisor' },
      { agentId: 'coder-1', role: 'coder', parentAgentId: 'supervisor' },
      { agentId: 'planner-1', role: 'planner', parentAgentId: 'supervisor' },
    ] as any
    const { flat, nested } = splitAgents(agents)
    expect(flat.map((a: any) => a.agentId)).toEqual(['supervisor'])
    expect(nested.map((a: any) => a.agentId)).toEqual(['coder-1', 'planner-1'])
  })
})
