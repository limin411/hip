import { describe, expect, it, vi } from 'vitest'
import { createManualCoalescer, type CoalesceBucket, type StreamKind } from './streamCoalesce'

function pushText(
  coalescer: ReturnType<typeof createManualCoalescer>['coalescer'],
  partial: {
    sessionId?: string
    turnId?: string
    agentId?: string
    kind?: StreamKind
    stepSeq?: number
    delta: string
  },
) {
  coalescer.push({
    sessionId: partial.sessionId ?? 's1',
    turnId: partial.turnId ?? 't1',
    agentId: partial.agentId ?? 'supervisor',
    kind: partial.kind ?? 'text-legacy',
    stepSeq: partial.stepSeq ?? -1,
    delta: partial.delta,
  })
}

describe('StreamCoalescer v2 (PR-3)', () => {
  it('merges deltas for the same kind+stepSeq key until tick', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { delta: 'Hel' })
    pushText(coalescer, { delta: 'lo' })
    expect(flush).not.toHaveBeenCalled()
    tick()
    expect(flush).toHaveBeenCalledTimes(1)
    const b = flush.mock.calls[0][0] as CoalesceBucket
    expect(b).toMatchObject({
      sessionId: 's1',
      turnId: 't1',
      agentId: 'supervisor',
      kind: 'text-legacy',
      stepSeq: -1,
      text: 'Hello',
    })
  })

  it('keeps separate buckets per agent', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { agentId: 'supervisor', kind: 'text-legacy', delta: 'A' })
    pushText(coalescer, { agentId: 'coder', kind: 'run-output', delta: 'B' })
    tick()
    expect(flush).toHaveBeenCalledTimes(2)
    const texts = flush.mock.calls.map((c) => (c[0] as CoalesceBucket).text).sort()
    expect(texts).toEqual(['A', 'B'])
  })

  it('does not merge different stepSeq for the same agent/kind', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { kind: 'text', stepSeq: 0, delta: 'first' })
    pushText(coalescer, { kind: 'text', stepSeq: 2, delta: 'second' })
    tick()
    expect(flush).toHaveBeenCalledTimes(2)
    const bySeq = new Map(
      flush.mock.calls.map((c) => {
        const b = c[0] as CoalesceBucket
        return [b.stepSeq, b.text]
      }),
    )
    expect(bySeq.get(0)).toBe('first')
    expect(bySeq.get(2)).toBe('second')
  })

  it('does not merge different kinds even with the same stepSeq', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    // Reasoning must never share a bucket with token text (PR-3 does not push reasoning in prod).
    pushText(coalescer, { kind: 'text', stepSeq: 1, delta: 'answer' })
    pushText(coalescer, { kind: 'reasoning', stepSeq: 1, delta: 'think' })
    tick()
    expect(flush).toHaveBeenCalledTimes(2)
    const kinds = flush.mock.calls.map((c) => (c[0] as CoalesceBucket).kind).sort()
    expect(kinds).toEqual(['reasoning', 'text'])
  })

  it('does not merge text-legacy with run-output for different agents', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { agentId: 'supervisor', kind: 'text-legacy', stepSeq: -1, delta: 'body' })
    pushText(coalescer, { agentId: 'coder-1', kind: 'run-output', stepSeq: -1, delta: 'run' })
    tick()
    const kinds = new Set(flush.mock.calls.map((c) => (c[0] as CoalesceBucket).kind))
    expect(kinds).toEqual(new Set(['text-legacy', 'run-output']))
  })

  it('flushAll drains without waiting for tick', () => {
    const flush = vi.fn()
    const { coalescer } = createManualCoalescer(flush)
    pushText(coalescer, { delta: 'x' })
    coalescer.flushAll()
    expect(flush).toHaveBeenCalledTimes(1)
    expect((flush.mock.calls[0][0] as CoalesceBucket).text).toBe('x')
  })

  it('flushTurn only drains matching turn', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { turnId: 't1', delta: 'a' })
    pushText(coalescer, { turnId: 't2', delta: 'b' })
    coalescer.flushTurn('s1', 't1')
    expect(flush).toHaveBeenCalledTimes(1)
    expect((flush.mock.calls[0][0] as CoalesceBucket).text).toBe('a')
    tick()
    expect(flush).toHaveBeenCalledTimes(2)
    expect((flush.mock.calls[1][0] as CoalesceBucket).text).toBe('b')
  })

  it('flushSession only drains matching session', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { sessionId: 's1', delta: 'a' })
    pushText(coalescer, { sessionId: 's2', delta: 'b' })
    coalescer.flushSession('s1')
    expect(flush).toHaveBeenCalledTimes(1)
    expect((flush.mock.calls[0][0] as CoalesceBucket).sessionId).toBe('s1')
    tick()
    expect((flush.mock.calls[1][0] as CoalesceBucket).sessionId).toBe('s2')
  })

  it('ignores empty deltas', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { delta: '' })
    tick()
    expect(flush).not.toHaveBeenCalled()
  })

  it('cancel handle prevents double flush after flushAll', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { delta: 'a' })
    coalescer.flushAll()
    expect(flush).toHaveBeenCalledTimes(1)
    // Prior bug: schedule cancel was discarded, so a pending tick could re-fire.
    // After cancel, tick is a no-op (pending cleared).
    tick()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('cancel after flushTurn of last bucket prevents empty scheduled flush', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { delta: 'a' })
    coalescer.flushTurn('s1', 't1')
    expect(flush).toHaveBeenCalledTimes(1)
    tick()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flushAll then push reschedules a fresh frame', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { delta: 'a' })
    coalescer.flushAll()
    pushText(coalescer, { delta: 'b' })
    expect(flush).toHaveBeenCalledTimes(1)
    tick()
    expect(flush).toHaveBeenCalledTimes(2)
    expect((flush.mock.calls[1][0] as CoalesceBucket).text).toBe('b')
  })

  it('clearSession discards without applying (persist/delete must win)', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { sessionId: 's1', delta: 'stale' })
    pushText(coalescer, { sessionId: 's2', delta: 'keep' })
    coalescer.clearSession('s1')
    expect(flush).not.toHaveBeenCalled()
    tick()
    expect(flush).toHaveBeenCalledTimes(1)
    expect((flush.mock.calls[0][0] as CoalesceBucket).sessionId).toBe('s2')
    expect((flush.mock.calls[0][0] as CoalesceBucket).text).toBe('keep')
  })

  it('clearSession of last buckets cancels the scheduled frame', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    pushText(coalescer, { delta: 'gone' })
    coalescer.clearSession('s1')
    tick()
    expect(flush).not.toHaveBeenCalled()
  })
})
