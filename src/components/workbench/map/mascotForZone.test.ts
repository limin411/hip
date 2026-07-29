import { describe, it, expect } from 'vitest'
import { mascotForHero, mascotForZone } from './mascotForZone'

describe('mascotForZone', () => {
  it('maps farm clips by state', () => {
    expect(mascotForZone('sessions', 'idle')).toBe('sleepy')
    expect(mascotForZone('knowledge', 'idle')).toBe('sunny')
    expect(mascotForZone('tasks', 'running')).toBe('jog')
    expect(mascotForZone('automations', 'done')).toBe('success')
    expect(mascotForZone('knowledge', 'fail')).toBe('melt')
  })
})

describe('mascotForHero', () => {
  it('maps aggregate hero', () => {
    expect(mascotForHero('idle')).toBe('wave')
    expect(mascotForHero('running')).toBe('run')
    expect(mascotForHero('done')).toBe('cheer')
  })
})
