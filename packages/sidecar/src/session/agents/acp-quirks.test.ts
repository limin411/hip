import { describe, it, expect } from 'vitest'
import { quirksFor } from './acp-quirks.js'

describe('acp quirks', () => {
  it('returns the opencode profile', () => {
    const q = quirksFor('opencode')
    expect(q.cancelReportsEndTurn).toBe(true)
    expect(q.defaultModelIsBilled).toBe(true)
  })
  it('returns safe defaults for unknown keys', () => {
    const q = quirksFor(undefined)
    expect(q.cancelReportsEndTurn).toBe(false)
  })
})
