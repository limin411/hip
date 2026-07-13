import { describe, it, expect } from 'vitest'
import {
  emitLoopSignal,
  type LoopEvent,
  type LoopEventSink,
} from './loop-events.js'
import type { GraphEmit } from './graph.js'

const base = { sessionId: 's1', turnId: 't1' }

describe('LoopEvent union', () => {
  it('accepts each discriminated variant', () => {
    const events: LoopEvent[] = [
      { type: 'loop.step', ...base, agentId: 'supervisor', step: 1, maxSteps: 800 },
      { type: 'loop.nudge', ...base, reason: 'doom' },
      { type: 'loop.nudge', ...base, reason: 'error_streak' },
      { type: 'loop.nudge', ...base, reason: 'path_hit' },
      { type: 'loop.nudge', ...base, reason: 'replan' },
      { type: 'loop.replan', ...base, reason: 'trailing tool errors' },
      { type: 'loop.pause', ...base, question: 'stuck?', kind: 'doom' },
      { type: 'loop.pause', ...base, question: 'plan ready?', kind: 'plan' },
      { type: 'loop.pause', ...base, question: 'subagent paused', kind: 'subagent_pause' },
      { type: 'loop.pause', ...base, question: 'generic pause' },
      { type: 'loop.budget', ...base, remaining: 10, total: 800 },
      { type: 'loop.end', ...base, reason: 'completed' },
      { type: 'loop.end', ...base, reason: 'max_steps' },
      { type: 'loop.end', ...base, reason: 'interrupt' },
      { type: 'loop.end', ...base, reason: 'abort' },
      { type: 'loop.end', ...base, reason: 'circuit_breaker' },
    ]
    expect(events).toHaveLength(16)
    expect(new Set(events.map((e) => e.type)).size).toBe(6)
  })

  it('narrows on type in a switch', () => {
    const e: LoopEvent = { type: 'loop.nudge', ...base, reason: 'doom' }
    let reason: string | undefined
    if (e.type === 'loop.nudge') {
      reason = e.reason
    }
    expect(reason).toBe('doom')
  })
})

describe('emitLoopSignal', () => {
  it('no-ops when sink is undefined', () => {
    expect(() =>
      emitLoopSignal(undefined, { type: 'loop.end', ...base, reason: 'completed' }),
    ).not.toThrow()
  })

  it('delivers the event to the sink', () => {
    const seen: LoopEvent[] = []
    const sink: LoopEventSink = (e) => {
      seen.push(e)
    }
    const ev: LoopEvent = { type: 'loop.replan', ...base, reason: 'errors' }
    emitLoopSignal(sink, ev)
    expect(seen).toEqual([ev])
  })

  it('swallows sink errors (best-effort)', () => {
    const sink: LoopEventSink = () => {
      throw new Error('sink blew up')
    }
    expect(() =>
      emitLoopSignal(sink, { type: 'loop.budget', ...base, remaining: 1, total: 10 }),
    ).not.toThrow()
  })
})

describe('GraphEmit.loopSignal surface', () => {
  it('is optional — GraphEmit without loopSignal remains assignable', () => {
    const emit: GraphEmit = {
      token: () => {},
      reasoning: () => {},
      toolStarted: () => {},
      toolFinished: () => {},
      usage: () => {},
      planDelta: () => {},
      compaction: () => {},
    }
    expect(emit.loopSignal).toBeUndefined()
    // Supported call pattern when absent: optional chaining no-ops.
    emit.loopSignal?.({ type: 'loop.end', ...base, reason: 'abort' })
  })

  it('accepts a LoopEventSink when provided', () => {
    const seen: LoopEvent[] = []
    const emit: GraphEmit = {
      token: () => {},
      reasoning: () => {},
      toolStarted: () => {},
      toolFinished: () => {},
      usage: () => {},
      planDelta: () => {},
      compaction: () => {},
      loopSignal: (e) => {
        seen.push(e)
      },
    }
    emit.loopSignal?.({ type: 'loop.nudge', ...base, reason: 'path_hit' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.type).toBe('loop.nudge')
  })
})
