import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { HeartbeatLoop, type HeartbeatConfig, type TickHandler, type StateChangeHandler } from './heartbeat-loop.js'

/** Create a minimal valid config for testing. Uses a short interval so tests are fast. */
function testConfig(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    id: 'test-loop',
    intervalMs: 50,
    agentId: 'test-agent',
    prompt: 'hello',
    ...overrides,
  }
}

describe('HeartbeatLoop', () => {
  let tickHandler: ReturnType<typeof vi.fn>
  let stateHandler: ReturnType<typeof vi.fn>
  let loop: HeartbeatLoop

  beforeEach(() => {
    vi.useFakeTimers()
    tickHandler = vi.fn().mockResolvedValue('ok')
    stateHandler = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws if interval is below 10ms', () => {
    expect(() => {
      new HeartbeatLoop({ ...testConfig({ intervalMs: 5 }), intervalMs: 5 }, tickHandler)
    }).toThrow('at least 10ms')
  })

  it('initial status is idle', () => {
    loop = new HeartbeatLoop(testConfig(), tickHandler)
    const s = loop.status()
    expect(s.status).toBe('idle')
    expect(s.runCount).toBe(0)
    expect(s.lastRunAt).toBeNull()
    expect(s.lastOutput).toBeNull()
  })

  it('start() transitions to running', () => {
    loop = new HeartbeatLoop(testConfig(), tickHandler)
    loop.start()
    expect(loop.status().status).toBe('running')
  })

  it('stop() transitions to stopped', () => {
    loop = new HeartbeatLoop(testConfig(), tickHandler)
    loop.start()
    loop.stop()
    expect(loop.status().status).toBe('stopped')
  })

  it('start() is idempotent when already running', () => {
    loop = new HeartbeatLoop(testConfig(), tickHandler)
    loop.start()
    loop.start() // should be no-op
    expect(loop.status().status).toBe('running')
  })

  it('stop() is idempotent when already stopped', () => {
    loop = new HeartbeatLoop(testConfig(), tickHandler)
    loop.stop()
    loop.stop() // should be no-op
    expect(loop.status().status).toBe('stopped')
  })

  it('executes tick and records output', async () => {
    tickHandler.mockResolvedValue('tick result')
    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000 }),
      tickHandler,
      stateHandler,
    )
    loop.start()

    // Advance past the first interval
    await vi.advanceTimersByTimeAsync(1000)

    expect(tickHandler).toHaveBeenCalledTimes(1)
    expect(tickHandler).toHaveBeenCalledWith('hello', expect.any(AbortSignal))

    const s = loop.status()
    expect(s.runCount).toBe(1)
    expect(s.lastRunAt).toBeGreaterThan(0)
    expect(s.lastOutput).toBe('tick result')
  })

  it('calls state handler after tick', async () => {
    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000 }),
      tickHandler.mockResolvedValue('done'),
      stateHandler,
    )
    loop.start()

    await vi.advanceTimersByTimeAsync(1000)

    // State handler should have been called at least once (emit + after tick)
    expect(stateHandler).toHaveBeenCalled()
    const lastCall = stateHandler.mock.calls[stateHandler.mock.calls.length - 1][0] as ReturnType<typeof loop.status>
    expect(lastCall.runCount).toBe(1)
    expect(lastCall.lastOutput).toBe('done')
  })

  it('executes multiple ticks', async () => {
    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000 }),
      tickHandler.mockResolvedValue('tick'),
    )
    loop.start()

    await vi.advanceTimersByTimeAsync(3000)

    expect(tickHandler).toHaveBeenCalledTimes(3)
    expect(loop.status().runCount).toBe(3)
  })

  it('stops after maxRuns', async () => {
    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000, maxRuns: 3 }),
      tickHandler.mockResolvedValue('tick'),
    )
    loop.start()

    await vi.advanceTimersByTimeAsync(5000)

    // Should have run exactly 3 times
    expect(tickHandler).toHaveBeenCalledTimes(3)
    expect(loop.status().runCount).toBe(3)
    expect(loop.status().status).toBe('stopped')
  })

  it('maxRuns = 0 never executes', async () => {
    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000, maxRuns: 0 }),
      tickHandler,
    )
    loop.start()

    // Immediately stops because runCount (0) >= maxRuns (0)
    expect(loop.status().status).toBe('stopped')
    await vi.advanceTimersByTimeAsync(1000)
    expect(tickHandler).not.toHaveBeenCalled()
  })

  it('cancel prevents next tick from executing', async () => {
    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000 }),
      tickHandler.mockResolvedValue('tick'),
    )
    loop.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(tickHandler).toHaveBeenCalledTimes(1)

    loop.stop()

    await vi.advanceTimersByTimeAsync(2000)
    // Should not have called tick handler again after stop
    expect(tickHandler).toHaveBeenCalledTimes(1)
  })

  it('aborts in-progress tick on stop', async () => {
    let signal: AbortSignal | undefined
    const slowHandler: TickHandler = async (_prompt, sig) => {
      signal = sig
      await new Promise<void>((resolve) => {
        // Wait until aborted
        const onAbort = () => {
          sig.removeEventListener('abort', onAbort)
          resolve()
        }
        sig.addEventListener('abort', onAbort)
      })
      return 'aborted'
    }

    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000 }),
      slowHandler,
    )
    loop.start()

    // Advance to trigger the tick
    await vi.advanceTimersByTimeAsync(1000)

    expect(signal).toBeDefined()
    expect(signal!.aborted).toBe(false)

    // Stop the loop — this should abort the signal
    loop.stop()
    expect(signal!.aborted).toBe(true)
  })

  it('recovers from tick error and continues', async () => {
    let callCount = 0
    const flakyHandler: TickHandler = async (_prompt) => {
      callCount++
      if (callCount === 1) throw new Error('first tick failed')
      return 'second tick ok'
    }

    loop = new HeartbeatLoop(
      testConfig({ intervalMs: 1000 }),
      flakyHandler,
    )
    loop.start()

    await vi.advanceTimersByTimeAsync(1000)

    // First tick: error recorded
    expect(loop.status().runCount).toBe(1)
    expect(loop.status().lastOutput).toContain('Error:')
    expect(loop.status().status).toBe('running')

    await vi.advanceTimersByTimeAsync(1000)

    // Second tick: succeeds
    expect(callCount).toBe(2)
    expect(loop.status().runCount).toBe(2)
    expect(loop.status().lastOutput).toBe('second tick ok')
  })

  it('resumes from initial state', () => {
    loop = new HeartbeatLoop(
      testConfig(),
      tickHandler,
      undefined,
      { runCount: 5, lastRunAt: 1000, lastOutput: 'previous', status: 'idle' },
    )
    const s = loop.status()
    expect(s.runCount).toBe(5)
    expect(s.lastRunAt).toBe(1000)
    expect(s.lastOutput).toBe('previous')
    expect(s.status).toBe('idle')
  })

  it('snapshot returns serializable state subset', () => {
    loop = new HeartbeatLoop(
      testConfig({ maxRuns: 10 }),
      tickHandler,
      undefined,
      { runCount: 3, lastRunAt: 12345, lastOutput: 'prev' },
    )
    const snap = loop.snapshot()
    expect(snap).toEqual({
      runCount: 3,
      lastRunAt: 12345,
      lastOutput: 'prev',
      status: 'idle',
    })
  })

  it('status() returns full state including config', () => {
    loop = new HeartbeatLoop(
      testConfig({ maxRuns: 10 }),
      tickHandler,
    )
    const s = loop.status()
    expect(s.id).toBe('test-loop')
    expect(s.config.agentId).toBe('test-agent')
    expect(s.config.intervalMs).toBe(50)
    expect(s.config.maxRuns).toBe(10)
    expect(s.config.prompt).toBe('hello')
    expect(s.createdAt).toBeGreaterThan(0)
    expect(s.updatedAt).toBeGreaterThan(0)
  })

  it('status() is safe to call after construction and before start', () => {
    loop = new HeartbeatLoop(testConfig(), tickHandler)
    const s = loop.status()
    expect(s.status).toBe('idle')
  })
})
