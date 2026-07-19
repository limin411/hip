import { describe, it, expect } from 'vitest'
import { runtimeModeOf, isExternalPrimary } from './sessionAgent'

describe('runtimeModeOf', () => {
  it('treats undefined / empty / builtin as builtin', () => {
    expect(runtimeModeOf(undefined)).toBe('builtin')
    expect(runtimeModeOf(null)).toBe('builtin')
    expect(runtimeModeOf('')).toBe('builtin')
    expect(runtimeModeOf('builtin')).toBe('builtin')
  })
  it('treats any other id as acp_primary', () => {
    expect(runtimeModeOf('acp-1')).toBe('acp_primary')
    expect(runtimeModeOf('opencode')).toBe('acp_primary')
  })
})

describe('isExternalPrimary', () => {
  it('mirrors runtimeModeOf', () => {
    expect(isExternalPrimary(undefined)).toBe(false)
    expect(isExternalPrimary('builtin')).toBe(false)
    expect(isExternalPrimary('x')).toBe(true)
  })
})
