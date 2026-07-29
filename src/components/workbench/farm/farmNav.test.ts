import { describe, it, expect } from 'vitest'
import { parseFarmKey, stepFarmFocus } from './farmNav'
import type { ZoneId } from '../workbenchTypes'

const ALL: ZoneId[] = [
  'sessions',
  'tasks',
  'automations',
  'knowledge',
  'terminals',
  'workflows',
]

describe('parseFarmKey', () => {
  it('maps arrows and wasd', () => {
    expect(parseFarmKey('ArrowLeft')).toBe('left')
    expect(parseFarmKey('d')).toBe('right')
    expect(parseFarmKey('W')).toBe('up')
    expect(parseFarmKey('Enter')).toBe('open')
    expect(parseFarmKey(' ')).toBe('open')
    expect(parseFarmKey('x')).toBe(null)
  })
})

describe('stepFarmFocus', () => {
  it('starts at sessions when empty focus', () => {
    expect(stepFarmFocus(null, 'right', ALL)).toBe('sessions')
  })

  it('walks courtyard graph', () => {
    expect(stepFarmFocus('sessions', 'right', ALL)).toBe('tasks')
    expect(stepFarmFocus('tasks', 'right', ALL)).toBe('automations')
    expect(stepFarmFocus('tasks', 'down', ALL)).toBe('workflows')
    expect(stepFarmFocus('workflows', 'left', ALL)).toBe('knowledge')
  })

  it('skips missing zones', () => {
    const subset: ZoneId[] = ['sessions', 'automations', 'workflows']
    expect(stepFarmFocus('sessions', 'right', subset)).toBe('automations')
  })
})
