import { describe, it, expect } from 'vitest'
import { quirksFor } from './acp-quirks.js'

describe('acp quirks', () => {
  it('returns the opencode profile', () => {
    const q = quirksFor('opencode')
    expect(q.cancelReportsEndTurn).toBe(true)
    expect(q.defaultModelIsBilled).toBe(true)
    // opencode does not tighten fallback — inherits DEFAULT set_model_mode
    expect(q.setConfigOptionFallback).toBe('set_model_mode')
  })
  it('returns safe defaults for unknown keys', () => {
    const q = quirksFor(undefined)
    expect(q.cancelReportsEndTurn).toBe(false)
    expect(q.defaultModelIsBilled).toBe(false)
  })
  it('DEFAULT setConfigOptionFallback is set_model_mode (preserves today catch-all)', () => {
    expect(quirksFor(undefined).setConfigOptionFallback).toBe('set_model_mode')
    expect(quirksFor('unknown-agent').setConfigOptionFallback).toBe('set_model_mode')
    expect(quirksFor('grok-build').setConfigOptionFallback).toBe('set_model_mode')
  })
})
