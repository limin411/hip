import { describe, it, expect } from 'vitest'
import { emitLoopSignal, type LoopEvent } from './loop-events.js'

describe('loop.compact / loop.prefire events', () => {
  it('emitLoopSignal delivers compact and prefire payloads', () => {
    const seen: LoopEvent[] = []
    const sink = (e: LoopEvent) => {
      seen.push(e)
    }

    emitLoopSignal(sink, {
      type: 'loop.compact',
      sessionId: 's1',
      turnId: 't1',
      reason: 'budget',
      used: 90_000,
      window: 100_000,
      fillPercent: 90,
      mode: 'user-turn',
      prefire: 'hit',
      tokensBefore: 50_000,
      tokensAfter: 20_000,
      hybrid: true,
      tokens: { input: 80_000, output: 1_200, cacheRead: 10_000 },
    })
    emitLoopSignal(sink, {
      type: 'loop.prefire',
      sessionId: 's1',
      turnId: 't1',
      outcome: 'started',
      used: 76_000,
      window: 100_000,
      fillPercent: 76,
      hybrid: true,
    })
    emitLoopSignal(sink, {
      type: 'loop.compact',
      sessionId: 's1',
      turnId: 't1',
      reason: 'overflow_secondary',
      mode: 'tool-round',
    })
    emitLoopSignal(sink, {
      type: 'loop.compact',
      sessionId: 's1',
      turnId: 't1',
      reason: 'budget',
      used: 92_000,
      window: 100_000,
      hybrid: true,
      throttled: true,
    })
    emitLoopSignal(sink, {
      type: 'loop.prefire',
      sessionId: 's1',
      turnId: 't1',
      outcome: 'started',
      used: 92_000,
      window: 100_000,
      throttled: true,
    })
    emitLoopSignal(sink, {
      type: 'loop.metrics',
      sessionId: 's1',
      turnId: 't1',
      metrics: {
        compactCount: 3,
        overflowRecoveries: 1,
        llmCompacts: 2,
        prunes: 0,
        slidingWindows: 0,
        prefireStarted: 2,
        prefireHit: 0,
        prefireMiss: 0,
        hybridCompacts: 2,
        throttledCompacts: 1,
        throttledPrefires: 1,
      },
      tokens: { input: 80_000, output: 1_200 },
    })

    expect(seen).toHaveLength(6)
    expect(seen[0]).toMatchObject({
      type: 'loop.compact',
      reason: 'budget',
      prefire: 'hit',
      hybrid: true,
      tokens: { input: 80_000, output: 1_200, cacheRead: 10_000 },
    })
    expect(seen[1]).toMatchObject({ type: 'loop.prefire', outcome: 'started', hybrid: true })
    expect(seen[2]).toMatchObject({ type: 'loop.compact', reason: 'overflow_secondary' })
    expect(seen[3]).toMatchObject({ type: 'loop.compact', hybrid: true, throttled: true })
    expect(seen[4]).toMatchObject({ type: 'loop.prefire', throttled: true })
    expect(seen[5]).toMatchObject({ type: 'loop.metrics', metrics: { compactCount: 3, overflowRecoveries: 1 } })
  })

  it('emitLoopSignal swallows sink errors', () => {
    expect(() =>
      emitLoopSignal(
        () => {
          throw new Error('boom')
        },
        { type: 'loop.end', sessionId: 's', turnId: 't', reason: 'abort' },
      ),
    ).not.toThrow()
  })
})
