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

    expect(seen).toHaveLength(3)
    expect(seen[0]).toMatchObject({ type: 'loop.compact', reason: 'budget', prefire: 'hit' })
    expect(seen[1]).toMatchObject({ type: 'loop.prefire', outcome: 'started' })
    expect(seen[2]).toMatchObject({ type: 'loop.compact', reason: 'overflow_secondary' })
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
