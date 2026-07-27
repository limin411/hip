// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { MISS_WINDOW_MS } from '@/domain/automations'
import type { Automation } from '@/domain/automations'

const load = vi.fn().mockResolvedValue(undefined)
const runNow = vi.fn().mockResolvedValue(undefined)
const recordSkip = vi.fn().mockResolvedValue(undefined)
const patchNextRunAt = vi.fn().mockResolvedValue(undefined)
const completeRun = vi.fn().mockResolvedValue(undefined)
const patchRunStatus = vi.fn().mockResolvedValue(undefined)

let automations: Automation[] = []
let loaded = true

vi.mock('@/store/automationStore', () => {
  const getState = () => ({
    loaded,
    automations,
    runs: [],
    load,
    runNow,
    recordSkip,
    patchNextRunAt,
    completeRun,
    patchRunStatus,
  })
  const useAutomationStore = Object.assign(
    (sel: (s: ReturnType<typeof getState>) => unknown) => sel(getState()),
    { getState },
  )
  return {
    useAutomationStore,
    listWatches: () => [],
  }
})

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: {
    getState: () => ({ sessions: [] }),
  },
}))

import {
  AutomationRunHost,
  AUTOMATION_TICK_MS,
  __resetAutomationRunHostForTests,
} from './AutomationRunHost'

function daily(id: string, nextRunAt: number): Automation {
  return {
    id,
    name: 'D',
    prompt: 'p',
    enabled: true,
    trigger: { kind: 'daily', hour: 10, minute: 0 },
    createdAt: 1,
    updatedAt: 1,
    nextRunAt,
  }
}

describe('AutomationRunHost', () => {
  beforeEach(() => {
    __resetAutomationRunHostForTests()
    automations = []
    loaded = true
    load.mockClear().mockResolvedValue(undefined)
    runNow.mockClear().mockResolvedValue(undefined)
    recordSkip.mockClear().mockResolvedValue(undefined)
    patchNextRunAt.mockClear()
    // Seed empty __hipE2E for hook install.
    ;(window as unknown as { __hipE2E?: Record<string, unknown> }).__hipE2E = {}
  })

  afterEach(() => {
    cleanup()
    delete (window as unknown as { __hipE2E?: unknown }).__hipE2E
    vi.useRealTimers()
  })

  it('exports 30s default tick interval', () => {
    expect(AUTOMATION_TICK_MS).toBe(30_000)
  })

  it('loads catalog on mount when not loaded', async () => {
    loaded = false
    render(
      <AutomationRunHost
        fireOnMount={false}
        clock={{
          setInterval: () => 1,
          clearInterval: () => undefined,
          nowMs: () => 0,
        }}
      />,
    )
    await waitFor(() => expect(load).toHaveBeenCalled())
  })

  it('fires due automation on mount tick with injectable nowMs', async () => {
    const next = 1_000_000
    automations = [daily('auto_due', next)]
    const nowMs = vi.fn(() => next)

    render(
      <AutomationRunHost
        fireOnMount
        clock={{
          nowMs,
          setInterval: () => 1,
          clearInterval: () => undefined,
        }}
      />,
    )

    await waitFor(() =>
      expect(runNow).toHaveBeenCalledWith('auto_due', {
        focus: false,
        trigger: 'schedule',
        nowMs: next,
      }),
    )
  })

  it('uses injectable setInterval with tickMs (no real 30s sleep)', async () => {
    const handlers: Array<() => void> = []
    const setIntervalFn = vi.fn((handler: () => void, ms: number) => {
      handlers.push(handler)
      expect(ms).toBe(100)
      return 42
    })
    const clearIntervalFn = vi.fn()
    let clock = 1_000_000
    automations = [daily('auto_tick', clock + 50)]

    render(
      <AutomationRunHost
        tickMs={100}
        fireOnMount={false}
        clock={{
          nowMs: () => clock,
          setInterval: setIntervalFn as AutomationRunHostClockSetInterval,
          clearInterval: clearIntervalFn,
        }}
      />,
    )

    await waitFor(() => expect(setIntervalFn).toHaveBeenCalled())
    expect(runNow).not.toHaveBeenCalled()

    // Advance past nextRunAt and fire the injected interval callback.
    clock = 1_000_100
    act(() => {
      handlers[0]?.()
    })

    await waitFor(() =>
      expect(runNow).toHaveBeenCalledWith('auto_tick', {
        focus: false,
        trigger: 'schedule',
        nowMs: 1_000_100,
      }),
    )

    cleanup()
    expect(clearIntervalFn).toHaveBeenCalledWith(42)
  })

  it('first tick coldStart → app_was_quit for lag≥6h; second uses missed_over_6h', async () => {
    const next = 1_000_000
    const far = next + MISS_WINDOW_MS + 1
    automations = [daily('auto_cs', next)]
    let now = far
    const handlers: Array<() => void> = []

    render(
      <AutomationRunHost
        fireOnMount
        clock={{
          nowMs: () => now,
          setInterval: ((h: () => void) => {
            handlers.push(h)
            return 1
          }) as AutomationRunHostClockSetInterval,
          clearInterval: () => undefined,
        }}
      />,
    )

    await waitFor(() =>
      expect(recordSkip).toHaveBeenCalledWith('auto_cs', {
        trigger: 'catchup',
        error: 'app_was_quit',
        now: far,
        rollNextRunAt: true,
      }),
    )

    // Second evaluation (interval): coldStart already consumed.
    // Reset nextRunAt still past miss window for the same auto.
    recordSkip.mockClear()
    automations = [daily('auto_cs', next)]
    now = far + 1
    act(() => {
      handlers[0]?.()
    })
    await waitFor(() =>
      expect(recordSkip).toHaveBeenCalledWith('auto_cs', {
        trigger: 'catchup',
        error: 'missed_over_6h',
        now: far + 1,
        rollNextRunAt: true,
      }),
    )
  })

  it('installs window.__hipE2E.automationTick for forced due', async () => {
    const next = 5_000_000
    automations = [daily('auto_e2e', next)]

    render(
      <AutomationRunHost
        fireOnMount={false}
        clock={{
          nowMs: () => 0,
          setInterval: () => 1,
          clearInterval: () => undefined,
        }}
      />,
    )

    await waitFor(() => {
      expect(
        (window as unknown as { __hipE2E?: { automationTick?: unknown } })
          .__hipE2E?.automationTick,
      ).toEqual(expect.any(Function))
    })

    act(() => {
      ;(
        window as unknown as {
          __hipE2E: { automationTick: (n?: number) => void }
        }
      ).__hipE2E.automationTick(next)
    })

    await waitFor(() =>
      expect(runNow).toHaveBeenCalledWith('auto_e2e', {
        focus: false,
        trigger: 'schedule',
        nowMs: next,
      }),
    )
  })

  it('ticks on window focus with injectable now', async () => {
    const next = 9_000_000
    automations = [daily('auto_focus', next)]
    const nowMs = vi.fn(() => next - 1000)

    render(
      <AutomationRunHost
        fireOnMount={false}
        clock={{
          nowMs,
          setInterval: () => 1,
          clearInterval: () => undefined,
        }}
      />,
    )

    await waitFor(() => expect(load).not.toHaveBeenCalled()) // already loaded

    nowMs.mockReturnValue(next)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() =>
      expect(runNow).toHaveBeenCalledWith('auto_focus', {
        focus: false,
        trigger: 'schedule',
        nowMs: next,
      }),
    )
  })

  it('focus during deferred load does not burn coldStart (app_was_quit after load)', async () => {
    const next = 1_000_000
    const far = next + MISS_WINDOW_MS + 1
    automations = [daily('auto_race', next)]
    loaded = false

    let resolveLoad!: () => void
    load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = () => {
            loaded = true
            resolve()
          }
        }),
    )

    render(
      <AutomationRunHost
        fireOnMount
        clock={{
          nowMs: () => far,
          setInterval: () => 1,
          clearInterval: () => undefined,
        }}
      />,
    )

    await waitFor(() => expect(load).toHaveBeenCalled())

    // Focus while load still pending — must not consume coldStart or fire.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(recordSkip).not.toHaveBeenCalled()
    expect(runNow).not.toHaveBeenCalled()

    // Catalog arrives; first real evaluation keeps coldStart → app_was_quit.
    await act(async () => {
      resolveLoad()
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(recordSkip).toHaveBeenCalledWith('auto_race', {
        trigger: 'catchup',
        error: 'app_was_quit',
        now: far,
        rollNextRunAt: true,
      }),
    )
    expect(recordSkip).toHaveBeenCalledTimes(1)
  })
})

/** Local helper type — keep test file free of exporting host clock type noise. */
type AutomationRunHostClockSetInterval = (
  handler: () => void,
  ms: number,
) => number
