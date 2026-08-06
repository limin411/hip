import { describe, it, expect } from 'vitest'
import type { TurnUsage } from '@hip/protocol'
import type { LoopEvent } from './loop-events.js'
import {
  accumulateLoopMetrics,
  aggregateLoopMetrics,
  buildContextBreakdownSnapshot,
  emptyLoopMetricsCounters,
  tokensByType,
} from './token-metrics.js'

const base = (partial: Partial<LoopEvent> & Pick<LoopEvent, 'type'>): LoopEvent =>
  ({
    sessionId: 's',
    turnId: 't',
    ...partial,
  }) as LoopEvent

describe('tokensByType', () => {
  it('returns undefined for null usage', () => {
    expect(tokensByType(null)).toBeUndefined()
    expect(tokensByType(undefined)).toBeUndefined()
  })

  it('maps input/output and omits zero optional buckets', () => {
    const u: TurnUsage = {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cacheReadTokens: 40,
      reasoningTokens: 5,
    }
    expect(tokensByType(u)).toEqual({
      input: 100,
      output: 20,
      cacheRead: 40,
      reasoning: 5,
    })
  })

  it('omits zero cache/reasoning', () => {
    expect(
      tokensByType({
        inputTokens: 10,
        outputTokens: 1,
        totalTokens: 11,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      }),
    ).toEqual({ input: 10, output: 1 })
  })
})

describe('aggregateLoopMetrics', () => {
  it('starts empty', () => {
    expect(aggregateLoopMetrics([])).toEqual(emptyLoopMetricsCounters())
  })

  it('counts compact reasons, hybrid, throttled, overflow', () => {
    const events: LoopEvent[] = [
      base({ type: 'loop.compact', reason: 'budget', hybrid: true }),
      base({ type: 'loop.compact', reason: 'overflow', hybrid: true }),
      base({ type: 'loop.compact', reason: 'overflow_secondary' }),
      base({ type: 'loop.compact', reason: 'prune' }),
      base({ type: 'loop.compact', reason: 'sliding_window' }),
      base({ type: 'loop.compact', reason: 'budget', throttled: true }),
      base({ type: 'loop.prefire', outcome: 'started', throttled: true }),
      base({ type: 'loop.prefire', outcome: 'hit' }),
      base({ type: 'loop.prefire', outcome: 'miss' }),
      base({ type: 'loop.end', reason: 'completed' }),
    ]
    const m = aggregateLoopMetrics(events)
    expect(m.compactCount).toBe(6)
    expect(m.overflowRecoveries).toBe(2)
    expect(m.llmCompacts).toBe(4) // budget×2 + overflow + overflow_secondary
    expect(m.prunes).toBe(1)
    expect(m.slidingWindows).toBe(1)
    expect(m.hybridCompacts).toBe(2)
    expect(m.throttledCompacts).toBe(1)
    expect(m.prefireStarted).toBe(1)
    expect(m.prefireHit).toBe(1)
    expect(m.prefireMiss).toBe(1)
    expect(m.throttledPrefires).toBe(1)
  })

  it('accumulateLoopMetrics is pure / incremental', () => {
    let acc = emptyLoopMetricsCounters()
    acc = accumulateLoopMetrics(
      acc,
      base({ type: 'loop.compact', reason: 'prune' }),
    )
    acc = accumulateLoopMetrics(
      acc,
      base({ type: 'loop.compact', reason: 'budget', hybrid: true }),
    )
    expect(acc.compactCount).toBe(2)
    expect(acc.prunes).toBe(1)
    expect(acc.llmCompacts).toBe(1)
    expect(acc.hybridCompacts).toBe(1)
  })
})

describe('buildContextBreakdownSnapshot', () => {
  it('derives inputBudget and tokensByType from usage', () => {
    const snap = buildContextBreakdownSnapshot({
      usage: {
        inputTokens: 900,
        outputTokens: 50,
        totalTokens: 950,
        contextTokens: 800,
        cacheReadTokens: 100,
      },
      turnId: 't1',
      hybrid: true,
    })
    expect(snap.inputBudget).toBe(800)
    expect(snap.tokensByType).toEqual({
      input: 900,
      output: 50,
      cacheRead: 100,
    })
    expect(snap.hybrid).toBe(true)
    expect(snap.turnId).toBe('t1')
    expect(snap.segments).toBeUndefined()
  })

  it('includes segments and metrics when provided', () => {
    const metrics = emptyLoopMetricsCounters()
    metrics.compactCount = 2
    metrics.overflowRecoveries = 1
    const snap = buildContextBreakdownSnapshot({
      inputBudget: 100,
      segments: [{ key: 'messages', tokens: 60, percent: 60 }],
      coarseSegments: [{ key: 'messages', tokens: 60, percent: 60 }],
      metrics,
    })
    expect(snap.segments).toHaveLength(1)
    expect(snap.coarseSegments?.[0].key).toBe('messages')
    expect(snap.metrics?.overflowRecoveries).toBe(1)
  })
})
