import { describe, it, expect } from 'vitest'
import { truncateMinutes, updateMinutes } from './minutes.js'

describe('minutes', () => {
  it('appends round blocks', () => {
    const m = updateMinutes(
      '',
      1,
      [{ speaker: 'strategist', content: 'Go long' }],
      { round: 1, agreed: ['A'], open: ['B'] },
    )
    expect(m).toContain('Round 1')
    expect(m).toContain('strategist')
    expect(m).toContain('Agreed: A')
  })

  it('truncates from the head when over max', () => {
    const long = 'x'.repeat(100)
    const t = truncateMinutes(long, 20)
    expect(t.length).toBeLessThanOrEqual(20 + 40) // prefix + tail
    expect(t).toContain('truncated')
  })
})
