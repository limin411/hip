import { describe, it, expect } from 'vitest'
import { mascotForHero, mascotForZone } from './mascotForZone'

describe('mascotForZone', () => {
  it('maps idle / blocked / done / fail with farm clips', () => {
    expect(mascotForZone('sessions', 'idle')).toBe('sleepy')
    expect(mascotForZone('knowledge', 'idle')).toBe('sunny')
    expect(mascotForZone('tasks', 'blocked')).toBe('thirsty')
    expect(mascotForZone('automations', 'done')).toBe('success')
    expect(mascotForZone('tasks', 'done')).toBe('champion')
    expect(mascotForZone('knowledge', 'fail')).toBe('melt')
  })

  it('uses zone-specific running actions', () => {
    expect(mascotForZone('sessions', 'running')).toBe('sprint')
    expect(mascotForZone('tasks', 'running')).toBe('jog')
    expect(mascotForZone('automations', 'running')).toBe('busy')
    expect(mascotForZone('knowledge', 'running')).toBe('thinking')
    expect(mascotForZone('terminals', 'running')).toBe('coffee')
  })
})

describe('mascotForHero', () => {
  it('maps aggregate states for field foreman', () => {
    expect(mascotForHero('idle')).toBe('wave')
    expect(mascotForHero('running')).toBe('run')
    expect(mascotForHero('blocked')).toBe('thirsty')
    expect(mascotForHero('done')).toBe('cheer')
    expect(mascotForHero('fail')).toBe('melt')
  })
})
