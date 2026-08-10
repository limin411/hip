// packages/sidecar/src/session/remote-compactor.test.ts
import { describe, it, expect } from 'vitest'
import { localFallbackCompactor } from './remote-compactor.js'

describe('remote compactor seam (G7 placeholder)', () => {
  it('is unsupported by default (local fallback path)', () => {
    expect(localFallbackCompactor.supported).toBe(false)
  })

  it('throws when called, so callers must use the local summarizer fallback', async () => {
    await expect(
      localFallbackCompactor.compact({ messages: [] }),
    ).rejects.toThrow(/not supported/)
  })
})
