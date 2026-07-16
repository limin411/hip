import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerComposerInserter,
  registerComposerHandlers,
  insertComposerText,
  replaceComposerText,
  setComposerQuote,
  insertComposerTextWhenReady,
  replaceComposerTextWhenReady,
  hasComposerInserter,
} from './composerBridge'

describe('composerBridge', () => {
  beforeEach(() => {
    registerComposerInserter(null)
    vi.useRealTimers()
  })

  it('insertComposerText returns false without inserter', () => {
    expect(insertComposerText('/x ')).toBe(false)
    expect(replaceComposerText('/x ')).toBe(false)
    expect(hasComposerInserter()).toBe(false)
  })

  it('legacy registerComposerInserter wires both insert and replace', () => {
    const fn = vi.fn()
    registerComposerInserter(fn)
    expect(insertComposerText('/x ')).toBe(true)
    expect(replaceComposerText('/y ')).toBe(true)
    expect(fn).toHaveBeenCalledWith('/x ')
    expect(fn).toHaveBeenCalledWith('/y ')
  })

  it('registerComposerHandlers separates insert and replace', () => {
    const insert = vi.fn()
    const replace = vi.fn()
    registerComposerHandlers({ insert, replace })
    insertComposerText('a')
    replaceComposerText('b')
    expect(insert).toHaveBeenCalledWith('a')
    expect(replace).toHaveBeenCalledWith('b')
    expect(insert).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('setComposerQuote uses setQuote when registered', () => {
    const setQuote = vi.fn()
    registerComposerHandlers({ insert: vi.fn(), replace: vi.fn(), setQuote })
    expect(setComposerQuote('hello')).toBe(true)
    expect(setQuote).toHaveBeenCalledWith('hello')
    expect(setComposerQuote(null)).toBe(true)
    expect(setQuote).toHaveBeenCalledWith(null)
  })

  it('setComposerQuote returns false without setQuote handler', () => {
    registerComposerHandlers({ insert: vi.fn(), replace: vi.fn() })
    expect(setComposerQuote('x')).toBe(false)
    registerComposerInserter(vi.fn())
    expect(setComposerQuote('x')).toBe(false)
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

  it('replaceComposerTextWhenReady uses replace handler', async () => {
    const insert = vi.fn()
    const replace = vi.fn()
    queueMicrotask(() => {
      registerComposerHandlers({ insert, replace })
    })
    const ok = await replaceComposerTextWhenReady('/z ', { attempts: 5, intervalMs: 0 })
    expect(ok).toBe(true)
    expect(replace).toHaveBeenCalledWith('/z ')
    expect(insert).not.toHaveBeenCalled()
  })
})
