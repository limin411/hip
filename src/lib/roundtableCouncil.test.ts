import { describe, it, expect } from 'vitest'
import {
  mergeCouncilRoster,
  isCouncilRoundtable,
  isCouncilLiveAgents,
  councilAgentId,
  deriveCouncilDiscussionRound,
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

  it('deriveCouncilDiscussionRound uses transcript rounds not chat turn index', () => {
    expect(
      deriveCouncilDiscussionRound(
        { engine: 'council', convened: true, roundsPlanned: 3 },
        '## 会议规划\n\n## 第 1 轮 — a\n\n### 阶段性结论\n\n## 第 3 轮 — c\n',
      ),
    ).toEqual({ current: 3, planned: 3 })

    expect(
      deriveCouncilDiscussionRound(
        {
          engine: 'council',
          convened: true,
          roundsRan: 2,
          roundsPlanned: 4,
          edges: [{ round: 2, from: 'a', to: 'b', relation: 'rebut', summary: 'x' }],
        },
        '',
      ),
    ).toEqual({ current: 2, planned: 4 })

    // Prefer content when ahead of finished meta (live stream).
    expect(
      deriveCouncilDiscussionRound(
        { engine: 'council', convened: true, roundsRan: 1, roundsPlanned: 3 },
        '## Round 3 — focus',
      ),
    ).toEqual({ current: 3, planned: 3 })
  })
})
