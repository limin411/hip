import { describe, it, expect } from 'vitest'
import { mascotForHero, mascotForZone } from './mascotForZone'

describe('mascotForZone', () => {
  it('maps idle / blocked / done / fail consistently', () => {
    expect(mascotForZone('sessions', 'idle')).toBe('sleepy')
    expect(mascotForZone('tasks', 'blocked')).toBe('deadline')
    expect(mascotForZone('automations', 'done')).toBe('success')
    expect(mascotForZone('knowledge', 'fail')).toBe('fail')
  })

  it('uses zone-specific running actions', () => {
    expect(mascotForZone('sessions', 'running')).toBe('coding')
    expect(mascotForZone('tasks', 'running')).toBe('review')
    expect(mascotForZone('automations', 'running')).toBe('busy')
    expect(mascotForZone('knowledge', 'running')).toBe('thinking')
    expect(mascotForZone('terminals', 'running')).toBe('coffee_work')
  })
})

describe('mascotForHero', () => {
  it('maps aggregate states', () => {
    expect(mascotForHero('idle')).toBe('wave')
    expect(mascotForHero('running')).toBe('coding')
    expect(mascotForHero('blocked')).toBe('deadline')
    expect(mascotForHero('done')).toBe('cheer')
    expect(mascotForHero('fail')).toBe('fail')
  })
})
