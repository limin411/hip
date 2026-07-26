import { describe, it, expect } from 'vitest'
import {
  mergeCouncilRoster,
  isCouncilRoundtable,
  isCouncilLiveAgents,
  councilAgentId,
} from './roundtableCouncil'
import type { TurnAgent } from './turnAgents'

describe('roundtableCouncil', () => {
  it('mergeCouncilRoster fills waiting seats', () => {
    const agents: TurnAgent[] = [
      {
        agentId: councilAgentId('strategist'),
        role: 'subagent',
        reasoning: '',
        tools: [],
        status: 'done',
        output: 'go A',
        elapsedMs: 10,
        parentAgentId: 'supervisor',
        name: 'Strategist',
      },
    ]
    const roster = mergeCouncilRoster(agents, {
      engine: 'council',
      convened: true,
      advisorCalls: 1,
    })
    expect(roster).toHaveLength(5)
    expect(roster!.find((s) => s.persona === 'strategist')?.status).toBe('done')
    expect(roster!.find((s) => s.persona === 'skeptic')?.status).toBe('waiting')
  })

  it('isCouncilRoundtable requires engine+convened', () => {
    expect(isCouncilRoundtable({ engine: 'loop', convened: true })).toBe(false)
    expect(isCouncilRoundtable({ engine: 'council', convened: false })).toBe(false)
    expect(isCouncilRoundtable({ engine: 'council', convened: true })).toBe(true)
  })

  it('isCouncilLiveAgents detects prefix without meta', () => {
    const agents: TurnAgent[] = [
      {
        agentId: councilAgentId('skeptic'),
        role: 'subagent',
        reasoning: '',
        tools: [],
        status: 'running',
        output: 'partial…',
        elapsedMs: 0,
        parentAgentId: 'supervisor',
      },
    ]
    expect(isCouncilLiveAgents(agents, null)).toBe(true)
    expect(mergeCouncilRoster(agents, null)?.find((s) => s.persona === 'skeptic')?.status).toBe(
      'running',
    )
    expect(mergeCouncilRoster([], null)).toBeNull()
  })
})
