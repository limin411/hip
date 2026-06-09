import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IdleWatchdog } from './idle-watchdog.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('IdleWatchdog', () => {
  it('fires onTimeout after the interval with no kicks', () => {
    const onTimeout = vi.fn()
    const w = new IdleWatchdog(100, onTimeout)
    w.kick()
    vi.advanceTimersByTime(99)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('kick resets the countdown', () => {
    const onTimeout = vi.fn()
    const w = new IdleWatchdog(100, onTimeout)
    w.kick()
    vi.advanceTimersByTime(80)
    w.kick() // reset
    vi.advanceTimersByTime(80)
    expect(onTimeout).not.toHaveBeenCalled() // 160ms total but reset at 80
    vi.advanceTimersByTime(20)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('stop prevents firing and makes later kicks no-ops', () => {
    const onTimeout = vi.fn()
    const w = new IdleWatchdog(100, onTimeout)
    w.kick()
    w.stop()
    vi.advanceTimersByTime(200)
    expect(onTimeout).not.toHaveBeenCalled()
    w.kick() // no-op after stop
    vi.advanceTimersByTime(200)
    expect(onTimeout).not.toHaveBeenCalled()
  })
})
