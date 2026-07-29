import { describe, it, expect } from 'vitest'
import { visualForHero, visualForZone } from './visualForZone'

describe('visualForZone', () => {
  it('maps states to tones and glow bands', () => {
    expect(visualForZone('idle').tone).toBe('neutral')
    expect(visualForZone('running').tone).toBe('active')
    expect(visualForZone('blocked').tone).toBe('warn')
    expect(visualForZone('fail').tone).toBe('danger')
    expect(visualForZone('done').tone).toBe('success')
    expect(visualForZone('running').glow).toBeGreaterThan(visualForZone('idle').glow)
    expect(visualForZone('running').flowSpeed).toBe(1)
  })

  it('attaches ringProgress only when progress > 0', () => {
    expect(visualForZone('running', null).ringProgress).toBeNull()
    expect(visualForZone('running', 0).ringProgress).toBeNull()
    expect(visualForZone('running', 0.4).ringProgress).toBe(0.4)
  })
})

describe('visualForHero', () => {
  it('reuses zone palette without progress', () => {
    expect(visualForHero('running').tone).toBe('active')
    expect(visualForHero('running').ringProgress).toBeNull()
  })
})
