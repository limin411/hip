import { describe, expect, it } from 'vitest'
import { isProjectPathBlocked, projectPathBlockReason } from './projectPathGate'

describe('projectPathBlockReason', () => {
  it('never blocks chat surface', () => {
    expect(projectPathBlockReason({ surface: 'chat' }, 'missing')).toBe('none')
    expect(projectPathBlockReason({ surface: 'chat', cwd: '/x' }, 'missing')).toBe('none')
  })

  it('blocks code without cwd', () => {
    expect(projectPathBlockReason({ surface: 'code' }, 'unknown')).toBe('unbound')
    expect(projectPathBlockReason({ surface: 'code', cwd: '  ' }, 'ok')).toBe('unbound')
  })

  it('blocks code when path is missing', () => {
    expect(projectPathBlockReason({ surface: 'code', cwd: '/gone' }, 'missing')).toBe('missing')
  })

  it('allows code when path ok or unknown (still probing)', () => {
    expect(projectPathBlockReason({ surface: 'code', cwd: '/p' }, 'ok')).toBe('none')
    expect(projectPathBlockReason({ surface: 'code', cwd: '/p' }, 'unknown')).toBe('none')
    expect(isProjectPathBlocked({ surface: 'code', cwd: '/p' }, 'ok')).toBe(false)
  })
})
