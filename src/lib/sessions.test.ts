import { describe, it, expect } from 'vitest'
import { surfaceOf } from './sessions'

describe('surfaceOf (frontend)', () => {
  it('returns the explicit surface', () => {
    expect(surfaceOf({ surface: 'chat' })).toBe('chat')
    expect(surfaceOf({ surface: 'code' })).toBe('code')
  })
  it('defaults to code when absent (the sidecar normally stamps it)', () => {
    expect(surfaceOf({})).toBe('code')
    expect(surfaceOf({ surface: undefined })).toBe('code')
  })
})


