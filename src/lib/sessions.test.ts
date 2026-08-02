import { describe, it, expect } from 'vitest'
import { isTerminalSession, surfaceOf } from './sessions'

describe('surfaceOf (frontend)', () => {
  it('returns the explicit surface', () => {
    expect(surfaceOf({ surface: 'chat' })).toBe('chat')
    expect(surfaceOf({ surface: 'code' })).toBe('code')
    expect(surfaceOf({ surface: 'terminal' })).toBe('terminal')
  })
  it('explicit terminal wins over workspaceMode inference', () => {
    expect(surfaceOf({ surface: 'terminal', workspaceMode: 'project' })).toBe('terminal')
  })
  it('isTerminalSession recognizes managed terminal conversations', () => {
    expect(isTerminalSession({ surface: 'terminal', managedTerminalId: 'tm_1' })).toBe(true)
    expect(isTerminalSession({ surface: 'code' })).toBe(false)
    expect(isTerminalSession({})).toBe(false)
  })
  it('defaults to code when absent (the sidecar normally stamps it)', () => {
    expect(surfaceOf({})).toBe('code')
    expect(surfaceOf({ surface: undefined })).toBe('code')
  })
})

