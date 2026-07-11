import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerComposerInserter,
  insertComposerText,
  insertComposerTextWhenReady,
  hasComposerInserter,
} from './composerBridge'

describe('composerBridge', () => {
  beforeEach(() => {
    registerComposerInserter(null)
    vi.useRealTimers()
  })

  it('insertComposerText returns false without inserter', () => {
    expect(insertComposerText('/x ')).toBe(false)
    expect(hasComposerInserter()).toBe(false)
  })

  it('insertComposerText invokes registered inserter', () => {
    const fn = vi.fn()
    registerComposerInserter(fn)
    expect(insertComposerText('/x ')).toBe(true)
    expect(fn).toHaveBeenCalledWith('/x ')
  })

  it('insertComposerTextWhenReady resolves after inserter appears', async () => {
    const fn = vi.fn()
    // Register before retries fire (microtask after first schedule(0)).
    queueMicrotask(() => {
      registerComposerInserter(fn)
    })
    const ok = await insertComposerTextWhenReady('/y ', { attempts: 5, intervalMs: 0 })
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledWith('/y ')
  })
})
