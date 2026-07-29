import { describe, it, expect } from 'vitest'
import { dayPartFromHour, resolveHeroCopy } from './heroGreeting'

describe('dayPartFromHour', () => {
  it('maps hour buckets', () => {
    expect(dayPartFromHour(6)).toBe('morning')
    expect(dayPartFromHour(14)).toBe('afternoon')
    expect(dayPartFromHour(20)).toBe('evening')
    expect(dayPartFromHour(23)).toBe('night')
    expect(dayPartFromHour(2)).toBe('night')
  })
})

describe('resolveHeroCopy', () => {
  it('uses time greeting only when idle', () => {
    const morning = new Date(2026, 0, 1, 9, 0, 0)
    const idle = resolveHeroCopy(
      'idle',
      'workbench.hero.titleIdle',
      'workbench.hero.subIdle',
      morning,
    )
    expect(idle.titleKey).toBe('workbench.hero.greetingMorning')

    const running = resolveHeroCopy(
      'running',
      'workbench.hero.titleRunning',
      'workbench.hero.subRunning',
      morning,
    )
    expect(running.titleKey).toBe('workbench.hero.titleRunning')
  })
})
