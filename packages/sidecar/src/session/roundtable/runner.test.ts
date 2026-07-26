import { describe, it, expect } from 'vitest'
import { runRoundtable } from './runner.js'
import { scriptedCompleteFns } from './complete.js'
import type { RoundtableEvent } from './types.js'

function j(obj: unknown): string {
  return JSON.stringify(obj)
}

/** Valid high-quality decide payload (passes structural quality bar). */
function decideOk(overrides: Record<string, unknown> = {}): string {
  return j({
    type: 'decide',
    verdict: 'Ship a phased rewrite with a two-week pilot before full cutover.',
    decision:
      'Adopt phased path A: pilot first, then RFC. Reject big-bang rewrite due to risk and cost.',
    keyTradeoffs: ['Speed vs risk'],
    residual: [],
    nextSteps: ['Run two-week pilot', 'Write RFC'],
    confidence: 'high',
    ...overrides,
  })
}

describe('runRoundtable', () => {
  it('council runs all 5 seats in parallel each round and collects edges', async () => {
    const starts: string[] = []
    const finishes: string[] = []
    // Council default cast = full 5-seat parallel roster every round.
    const fiveSpeeches = (round: number) =>
      [
        JSON.stringify({
          prose: `R${round} strategist.`,
          acts: [{ kind: 'open', claim: 'Go big' }],
        }),
        JSON.stringify({
          prose: `R${round} skeptic.`,
          acts: [
            {
              kind: 'rebut',
              claim: 'Too risky',
              target: 'strategist',
              attack: 'cost',
            },
          ],
        }),
        JSON.stringify({
          prose: `R${round} creative.`,
          acts: [{ kind: 'open', claim: 'hybrid' }],
        }),
        JSON.stringify({
          prose: `R${round} operator.`,
          acts: [{ kind: 'open', claim: 'phased' }],
        }),
        JSON.stringify({
          prose: `R${round} audience.`,
          acts: [{ kind: 'support', claim: 'users first', target: 'operator' }],
        }),
      ] as string[]
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: true }),
      j({ type: 'plan', rounds: 2, agenda: ['a', 'b'], rationale: 'r' }),
      j({
        type: 'open_round',
        round: 1,
        focus: 'f',
        speakers: ['strategist', 'skeptic'],
      }),
      ...fiveSpeeches(1),
      j({ type: 'stage', round: 1, agreed: ['split'], open: [], nextFocus: 'x' }),
      j({
        type: 'open_round',
        round: 2,
        focus: 'x',
        speakers: ['operator'],
      }),
      ...fiveSpeeches(2),
      j({ type: 'stage', round: 2, agreed: ['phased'], open: [] }),
      decideOk({
        verdict: 'Phased rewrite is the right call.',
        decision:
          'Adopt phased delivery over big-bang rewrite; residual cost risk stays open for RFC.',
      }),
    ])
    const result = await runRoundtable({
      issue: 'api rewrite',
      language: 'en',
      signal: new AbortController().signal,
      llm,
      councilMode: true,
      advisorHooks: {
        onStart: ({ agentId }) => {
          starts.push(agentId)
        },
        onFinish: ({ agentId }) => {
          finishes.push(agentId)
        },
      },
    })
    expect(result.advisorCalls).toBe(10) // 5 × 2 rounds
    expect(starts.length).toBe(10)
    expect(finishes).toEqual(starts)
    expect(starts).toContain('roundtable:strategist')
    expect(starts).toContain('roundtable:audience')
    expect(new Set(starts).size).toBe(5)
    expect(result.edges?.some((e) => e.relation === 'rebut')).toBe(true)
    expect(result.report?.rounds).toHaveLength(2)
    expect(result.report?.rounds[0]?.speeches).toHaveLength(5)
    expect(result.report?.decision?.verdict).toContain('Phased rewrite')
    expect(result.report?.cast?.length).toBe(5)
    expect(result.markdown).toContain('Core verdict')
  })

  it('runAdvisor is used instead of llm.complete for advisor seats', async () => {
    const advisorIds: string[] = []
    let completeAdvisorCalls = 0
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: true }),
      j({ type: 'plan', rounds: 2, agenda: ['a', 'b'], rationale: 'r' }),
      j({
        type: 'open_round',
        round: 1,
        focus: 'f',
        speakers: ['strategist', 'skeptic'],
      }),
      j({ type: 'stage', round: 1, agreed: ['ok'], open: [], nextFocus: 'x' }),
      j({
        type: 'open_round',
        round: 2,
        focus: 'x',
        speakers: ['operator'],
      }),
      j({ type: 'stage', round: 2, agreed: ['done'], open: [] }),
      decideOk(),
    ])
    // Wrap complete to count advisor tags (should stay 0 when runAdvisor is set)
    const baseComplete = llm.complete.bind(llm)
    llm.complete = async (args) => {
      if (args.tag.startsWith('advisor:')) completeAdvisorCalls++
      return baseComplete(args)
    }
    const result = await runRoundtable({
      issue: 'topic',
      language: 'en',
      signal: new AbortController().signal,
      llm,
      councilMode: true,
      runAdvisor: async ({ agentId, system, displayName }) => {
        advisorIds.push(agentId)
        expect(system).toMatch(/Mission|lens|Skeptic|Strategist|must/i)
        if (displayName) expect(displayName.length).toBeGreaterThan(0)
        return `speech from ${agentId}`
      },
    })
    expect(result.phase).toBe('done')
    expect(completeAdvisorCalls).toBe(0)
    expect(advisorIds.length).toBe(10) // 5 seats × 2 rounds, full parallel
    expect(advisorIds.every((id) => id.startsWith('roundtable:'))).toBe(true)
    expect(new Set(advisorIds).size).toBe(5)
  })

  it('L3 cast of 3 seats limits council speakers and injects custom titles', async () => {
    const advisorIds: string[] = []
    const titles: string[] = []
    const cast = [
      {
        id: 'skeptic',
        title: 'Reg risk challenger',
        lens: 'Regulatory failure modes for this product',
        mustCover: ['Who is liable if model errs?'],
      },
      {
        id: 'operator',
        title: 'Launch operator',
        lens: 'Ship checklist and ownership',
        mustCover: ['Critical path this quarter'],
      },
      {
        id: 'audience',
        title: 'User trust advocate',
        lens: 'Trust and clarity for end users',
        mustCover: ['What confuses non-experts?'],
      },
    ]
    // Speeches come from runAdvisor — chair scripts only (no advisor complete queue).
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: true }),
      j({
        type: 'plan',
        rounds: 2,
        agenda: ['risk', 'ship'],
        rationale: 'narrow cast',
        cast,
      }),
      j({
        type: 'open_round',
        round: 1,
        focus: 'risk',
        speakers: ['skeptic', 'operator', 'audience'],
      }),
      j({ type: 'stage', round: 1, agreed: ['a'], open: [], nextFocus: 'ship' }),
      j({
        type: 'open_round',
        round: 2,
        focus: 'ship',
        speakers: ['operator'],
      }),
      j({ type: 'stage', round: 2, agreed: ['b'], open: [] }),
      decideOk({
        verdict: 'Launch with trust gates and explicit liability owners.',
        decision:
          'Adopt operator checklist plus skeptic liability mapping; reject silent launch without user-facing risk copy.',
      }),
    ])
    const result = await runRoundtable({
      issue: 'Should we ship AI agents that can move money?',
      language: 'en',
      signal: new AbortController().signal,
      llm,
      councilMode: true,
      runAdvisor: async ({ agentId, system, displayName, user }) => {
        advisorIds.push(agentId)
        if (displayName) titles.push(displayName)
        expect(system).toMatch(/Reg risk|Launch operator|User trust|Mission|lens/i)
        expect(user).toContain('Should we ship AI agents')
        return `speech ${agentId}`
      },
    })
    expect(result.phase).toBe('done')
    expect(result.advisorCalls).toBe(6) // 3 × 2
    expect(new Set(advisorIds).size).toBe(3)
    expect(advisorIds).not.toContain('roundtable:strategist')
    expect(titles).toContain('Reg risk challenger')
    expect(result.report?.cast?.map((c) => c.id).sort()).toEqual([
      'audience',
      'operator',
      'skeptic',
    ])
    expect(result.markdown).toContain('Reg risk challenger')
  })

  it('route skip → normal reply, zero advisor calls', async () => {
    const events: RoundtableEvent[] = []
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: false, reply: 'It is 3pm.' }),
    ])
    const result = await runRoundtable({
      issue: 'what time is it',
      language: 'en',
      signal: new AbortController().signal,
      llm,
      onEvent: (e) => events.push(e),
    })
    expect(result.phase).toBe('done')
    expect(result.convened).toBe(false)
    expect(result.advisorCalls).toBe(0)
    expect(result.markdown).toContain('It is 3pm.')
    expect(events.some((e) => e.kind === 'roundtable.normal_reply')).toBe(true)
  })

  it('convene → plan → 2 rounds → decide with independent advisor calls', async () => {
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: true, reason: 'tradeoffs' }),
      j({
        type: 'plan',
        rounds: 2,
        agenda: ['Frame options', 'Pick path'],
        rationale: 'two clear forks',
      }),
      // round 1 open
      j({
        type: 'open_round',
        round: 1,
        focus: 'options',
        speakers: ['strategist', 'skeptic'],
      }),
      'Long-term we should pick A.',
      'Risk: A is expensive.',
      j({
        type: 'stage',
        round: 1,
        agreed: ['A vs B is the fork'],
        open: ['cost'],
        nextFocus: 'cost of A',
      }),
      // round 2
      j({
        type: 'open_round',
        round: 2,
        focus: 'cost',
        speakers: ['operator', 'audience'],
      }),
      'Ship A phased.',
      'Users want reliability first.',
      j({
        type: 'stage',
        round: 2,
        agreed: ['phased A'],
        open: [],
      }),
      decideOk({
        verdict: 'Adopt phased A with a spike before full rewrite.',
        decision:
          'Adopt phased A: spike then RFC. Reject big-bang due to timeline risk and user reliability needs.',
        residual: ['timeline risk'],
        nextSteps: ['spike', 'RFC'],
      }),
    ])

    const result = await runRoundtable({
      issue: 'Should we rewrite the API?',
      language: 'en',
      signal: new AbortController().signal,
      llm,
    })
    expect(result.phase).toBe('done')
    expect(result.convened).toBe(true)
    expect(result.advisorCalls).toBe(4)
    expect(result.roundsRan).toBe(2)
    expect(result.markdown).toContain('Meeting plan')
    expect(result.markdown).toContain('Strategist:')
    expect(result.markdown).toContain('Stage conclusion')
    expect(result.markdown).toContain('Adopt phased A')
    expect(result.markdown).toContain('Core verdict')
    expect(result.markdown).toContain('Next steps')
  })

  it('early exit after round 1 still decides', async () => {
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: true }),
      j({
        type: 'plan',
        rounds: 3,
        agenda: ['r1', 'r2', 'r3'],
        rationale: 'x',
      }),
      j({
        type: 'open_round',
        round: 1,
        focus: 'core',
        speakers: ['strategist'],
      }),
      'Clear consensus path.',
      j({
        type: 'stage',
        round: 1,
        agreed: ['path clear'],
        open: [],
        earlyExit: true,
        earlyExitReason: 'enough agreement',
      }),
      decideOk({
        verdict: 'Go with the consensus path from round 1.',
        decision:
          'Enough agreement after round 1: ship the clear consensus path without further rounds.',
        nextSteps: ['do it'],
      }),
    ])
    const result = await runRoundtable({
      issue: 'pick a logo color',
      language: 'en',
      signal: new AbortController().signal,
      llm,
    })
    expect(result.earlyExit).toBe(true)
    expect(result.roundsRan).toBe(1)
    expect(result.advisorCalls).toBe(1)
    expect(result.markdown).toContain('consensus path')
  })

  it('abort mid-meeting keeps partial markdown', async () => {
    const ac = new AbortController()
    let n = 0
    const llm = {
      complete: async () => {
        n++
        if (n === 1) return j({ type: 'route', convene: true })
        if (n === 2) return j({ type: 'plan', rounds: 2, agenda: ['a', 'b'], rationale: 'r' })
        if (n === 3) {
          ac.abort()
          return j({
            type: 'open_round',
            round: 1,
            focus: 'f',
            speakers: ['strategist'],
          })
        }
        return 'should not run'
      },
    }
    const result = await runRoundtable({
      issue: 'big topic',
      language: 'en',
      signal: ac.signal,
      llm,
    })
    expect(result.phase).toBe('aborted')
    expect(result.markdown).toMatch(/Meeting plan|Convening|cancelled/i)
  })

  it('parallel_then_synth runs advisors concurrently without cross-talk order dependency', async () => {
    let inFlight = 0
    let maxInFlight = 0
    let chairStep = 0
    const chairScripts = [
      j({ type: 'route', convene: true }),
      j({ type: 'plan', rounds: 2, agenda: ['a', 'b'], rationale: 'r' }),
      j({
        type: 'open_round',
        round: 1,
        focus: 'f',
        speakers: ['strategist', 'skeptic', 'creative'],
        mode: 'parallel_then_synth',
      }),
      j({ type: 'stage', round: 1, agreed: ['x'], open: [], nextFocus: 'y' }),
      j({
        type: 'open_round',
        round: 2,
        focus: 'y',
        speakers: ['operator'],
        mode: 'serial_react',
      }),
      j({ type: 'stage', round: 2, agreed: ['z'], open: [] }),
      decideOk(),
    ]
    const hybrid = {
      complete: async ({ tag, signal }: { tag: string; signal: AbortSignal }) => {
        if (signal.aborted) {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        }
        if (tag.startsWith('chair')) {
          const s = chairScripts[chairStep++]
          if (!s) throw new Error('chair exhausted')
          return s
        }
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 20))
        inFlight--
        return `ok-${tag}`
      },
    }
    const result = await runRoundtable({
      issue: 'parallel topic',
      language: 'en',
      signal: new AbortController().signal,
      llm: hybrid,
    })
    expect(result.phase).toBe('done')
    expect(result.advisorCalls).toBe(4)
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
    expect(result.markdown).toContain('ok')
  })

  it('maxAdvisorCalls forces exit to decide path via break', async () => {
    // After max advisors, stage still runs then loop breaks → decide
    const llm = scriptedCompleteFns([
      j({ type: 'route', convene: true }),
      j({ type: 'plan', rounds: 2, agenda: ['a', 'b'], rationale: 'r' }),
      j({
        type: 'open_round',
        round: 1,
        focus: 'f',
        speakers: ['strategist', 'skeptic', 'creative'],
      }),
      's1',
      's2', // only 2 advisors allowed by maxAdvisorCalls=2
      // stage still after partial speakers
      j({
        type: 'stage',
        round: 1,
        agreed: ['partial'],
        open: ['more'],
        nextFocus: 'x',
      }),
      // round 2 open would be skipped if advisorCalls>=max at loop head — after r1 we have 2 calls
      decideOk({
        verdict: 'Forced wrap due to advisor budget.',
        decision:
          'Meeting hit max advisor calls; wrap with partial consensus and re-run if needed.',
        nextSteps: ['stop', 're-run if needed'],
      }),
    ])
    const result = await runRoundtable({
      issue: 'topic',
      language: 'en',
      signal: new AbortController().signal,
      llm,
      maxAdvisorCalls: 2,
    })
    expect(result.phase).toBe('done')
    expect(result.advisorCalls).toBe(2)
    expect(result.markdown).toContain('Forced wrap')
  })
})
