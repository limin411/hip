// packages/sidecar/src/session/turn-timing.test.ts
import { describe, it, expect } from 'vitest'
import { TurnTimer, summarizeTurnTimings } from './turn-timing.js'

describe('TurnTimer', () => {
  it('records ttft from the first token and ttfm from finish', () => {
    const t = new TurnTimer(1000)
    expect(t.ttft()).toBeNull()
    t.markFirstToken(1300)
    expect(t.ttft()).toBe(300)
    // later marks are ignored (first wins)
    t.markFirstToken(5000)
    expect(t.ttft()).toBe(300)
    t.finish(4200)
    const s = t.stats()
    expect(s.ttftMs).toBe(300)
    expect(s.ttfmMs).toBe(3200)
    expect(s.totalMs).toBe(3200)
  })

  it('finish is idempotent', () => {
    const t = new TurnTimer(0)
    t.finish(100)
    t.finish(200)
    expect(t.stats().ttfmMs).toBe(100)
  })

  it('falls back to now when never finished', () => {
    const t = new TurnTimer(1000)
    const s = t.stats(5000)
    expect(s.totalMs).toBe(4000)
    // no first token: ttft falls back to total
    expect(s.ttftMs).toBe(4000)
  })
})

describe('summarizeTurnTimings', () => {
  it('aggregates steps and keeps the first ttft', () => {
    const out = summarizeTurnTimings(
      [
        { ttftMs: 200, ttfmMs: 900, totalMs: 900 },
        { ttftMs: 50, ttfmMs: 600, totalMs: 600 },
      ],
      150,
    )
    expect(out.steps).toBe(2)
    expect(out.ttftMs).toBe(200)
    expect(out.ttfmMs).toBe(1500)
    expect(out.totalMs).toBe(1500)
    expect(out.toolBlockMs).toBe(150)
  })

  it('handles empty steps', () => {
    const out = summarizeTurnTimings([], 0)
    expect(out.ttftMs).toBeNull()
    expect(out.ttfmMs).toBe(0)
    expect(out.steps).toBe(0)
  })
})
