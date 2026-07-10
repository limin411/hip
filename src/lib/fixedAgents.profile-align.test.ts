import { describe, it, expect } from 'vitest'
import { FIXED_AGENT_IDS } from '@hip/protocol'

/**
 * Sprint C: UI fixed agents and sidecar BUILTIN_PROFILES share the same id strings.
 * Sidecar list is mirrored here to avoid importing Node-only sidecar into frontend unit tests.
 */
const SIDECAR_FIXED_PROFILE_IDS = ['coder', 'explore', 'plan'] as const

describe('fixed agent id alignment', () => {
  it('FIXED_AGENT_IDS matches sidecar fixed profiles', () => {
    expect([...FIXED_AGENT_IDS].sort()).toEqual([...SIDECAR_FIXED_PROFILE_IDS].sort())
  })

  it('does not include legacy worker as a fixed UI agent', () => {
    expect(FIXED_AGENT_IDS).not.toContain('worker')
  })
})
