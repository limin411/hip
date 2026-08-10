// packages/sidecar/src/session/elicitation.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ElicitationCoordinator, ELICITATION_PENDING_PREFIX } from './elicitation.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('ElicitationCoordinator', () => {
  it('starts paused and resumes on resolve', () => {
    const c = new ElicitationCoordinator()
    expect(c.paused).toBe(false)
    const e = c.register('which approach?')
    expect(c.paused).toBe(true)
    expect(c.current()?.id).toBe(e.id)
    expect(c.current()?.question).toBe('which approach?')
    const ok = c.resolve(e.id, 'option A', 'user')
    expect(ok).toBe(true)
    expect(c.paused).toBe(false)
    expect(c.current()).toBeNull()
  })

  it('resolve with unknown id is a no-op and stays paused', () => {
    const c = new ElicitationCoordinator()
    c.register('q')
    expect(c.resolve('el-nope', 'x', 'user')).toBe(false)
    expect(c.paused).toBe(true)
  })

  it('registering a second question cancels the first', () => {
    const c = new ElicitationCoordinator()
    c.register('first', {})
    const e1 = c.current()!
    c.register('second', {})
    expect(c.current()?.question).toBe('second')
    // resolving the superseded id is a no-op (it was already cancelled)
    expect(c.resolve(e1.id, 'x', 'user')).toBe(false)
    expect(c.current()?.question).toBe('second')
  })

  it('auto-resolves on timeout', () => {
    vi.useFakeTimers()
    const resolved: Array<{ by: string }> = []
    const c = new ElicitationCoordinator({
      timeoutMs: 5000,
      onResolved: (_e, r) => resolved.push({ by: r.by }),
    })
    c.register('timeout question')
    expect(c.paused).toBe(true)
    vi.advanceTimersByTime(5001)
    expect(c.paused).toBe(false)
    expect(resolved).toEqual([{ by: 'timeout' }])
  })

  it('fires onStarted and onResolved hooks', () => {
    const started: string[] = []
    const resolved: string[] = []
    const c = new ElicitationCoordinator({
      onStarted: (e) => started.push(e.question),
      onResolved: (_e, r) => resolved.push(`${r.id}:${r.answer}:${r.by}`),
    })
    const e = c.register('scope?', { options: ['small', 'large'] })
    expect(started).toEqual(['scope?'])
    c.resolve(e.id, 'small', 'user')
    expect(resolved).toEqual([`${e.id}:small:user`])
  })

  it('cancelAll clears pause', () => {
    const c = new ElicitationCoordinator()
    c.register('q')
    c.cancelAll()
    expect(c.paused).toBe(false)
  })

  it('exposes the pending prefix constant', () => {
    expect(ELICITATION_PENDING_PREFIX).toContain('[Deferred:')
  })
})
