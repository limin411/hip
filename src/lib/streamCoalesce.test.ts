import { describe, expect, it, vi } from 'vitest'
import { createManualCoalescer } from './streamCoalesce'

describe('StreamCoalescer (P1)', () => {
  it('merges deltas for the same agent until tick', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    coalescer.push('s1', 't1', 'supervisor', 'Hel')
    coalescer.push('s1', 't1', 'supervisor', 'lo')
    expect(flush).not.toHaveBeenCalled()
    tick()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('s1', 't1', 'supervisor', 'Hello')
  })

  it('keeps separate buckets per agent', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    coalescer.push('s1', 't1', 'supervisor', 'A')
    coalescer.push('s1', 't1', 'coder', 'B')
    tick()
    expect(flush).toHaveBeenCalledTimes(2)
    expect(flush.mock.calls.map((c) => c[3]).sort()).toEqual(['A', 'B'])
  })

  it('flushAll drains without waiting for tick', () => {
    const flush = vi.fn()
    const { coalescer } = createManualCoalescer(flush)
    coalescer.push('s1', 't1', 'supervisor', 'x')
    coalescer.flushAll()
    expect(flush).toHaveBeenCalledWith('s1', 't1', 'supervisor', 'x')
  })

  it('flushTurn only drains matching turn', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    coalescer.push('s1', 't1', 'supervisor', 'a')
    coalescer.push('s1', 't2', 'supervisor', 'b')
    coalescer.flushTurn('s1', 't1')
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith('s1', 't1', 'supervisor', 'a')
    tick()
    expect(flush).toHaveBeenCalledWith('s1', 't2', 'supervisor', 'b')
  })

  it('ignores empty deltas', () => {
    const flush = vi.fn()
    const { coalescer, tick } = createManualCoalescer(flush)
    coalescer.push('s1', 't1', 'supervisor', '')
    tick()
    expect(flush).not.toHaveBeenCalled()
  })
})
