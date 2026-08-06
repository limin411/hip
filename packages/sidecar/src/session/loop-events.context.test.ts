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
    })
    emitLoopSignal(sink, {
      type: 'loop.prefire',
      sessionId: 's1',
      turnId: 't1',
      outcome: 'started',
      used: 76_000,
      window: 100_000,
      fillPercent: 76,
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

    expect(seen).toHaveLength(5)
    expect(seen[0]).toMatchObject({ type: 'loop.compact', reason: 'budget', prefire: 'hit', hybrid: true })
    expect(seen[1]).toMatchObject({ type: 'loop.prefire', outcome: 'started' })
    expect(seen[2]).toMatchObject({ type: 'loop.compact', reason: 'overflow_secondary' })
    expect(seen[3]).toMatchObject({ type: 'loop.compact', hybrid: true, throttled: true })
    expect(seen[4]).toMatchObject({ type: 'loop.prefire', throttled: true })
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
