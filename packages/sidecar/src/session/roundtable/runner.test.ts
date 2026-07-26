import { describe, it, expect } from 'vitest'
import { runRoundtable } from './runner.js'
import { scriptedCompleteFns } from './complete.js'
import type { RoundtableEvent } from './types.js'

function j(obj: unknown): string {
  return JSON.stringify(obj)
}

describe('runRoundtable', () => {
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
      j({
        type: 'decide',
        decision: 'Adopt phased A',
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
      j({
        type: 'decide',
        decision: 'Go',
        residual: [],
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
    expect(result.markdown).toContain('Go')
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
      j({
        type: 'decide',
        decision: 'forced wrap',
        residual: [],
        nextSteps: ['stop'],
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
    expect(result.markdown).toContain('forced wrap')
  })
})
