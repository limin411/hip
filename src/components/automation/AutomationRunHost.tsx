import { useCallback, useEffect, useRef } from 'react'
import { useAutomationStore } from '@/store/automationStore'
import { automationHostTick } from './automationScheduleTick'

/** Default host poll interval (design: ±30s schedule precision). */
export const AUTOMATION_TICK_MS = 30_000

export type AutomationRunHostClock = {
  /** Injectable wall clock (tests). Default `Date.now`. */
  nowMs: () => number
  /** Injectable interval. Default `window.setInterval`. */
  setInterval: (handler: () => void, ms: number) => number
  /** Injectable clear. Default `window.clearInterval`. */
  clearInterval: (id: number) => void
}

export type AutomationRunHostProps = {
  /** Override default 30s tick period (tests may use shorter). */
  tickMs?: number
  /** Injectable clock + timers so unit tests never sleep 30s. */
  clock?: Partial<AutomationRunHostClock>
  /**
   * When false, skip the immediate post-load tick (tests that drive
   * ticks only via the e2e hook / exposed `automationTick`).
   * Default true.
   */
  fireOnMount?: boolean
}

/** Process-lifetime: first schedule evaluation uses coldStart → app_was_quit. */
let coldStartPending = true

/** Test helper: reset cold-start latch between cases. */
export function __resetAutomationRunHostForTests(): void {
  coldStartPending = true
}

function defaultClock(): AutomationRunHostClock {
  return {
    nowMs: () => Date.now(),
    setInterval: (handler, ms) => window.setInterval(handler, ms) as unknown as number,
    clearInterval: (id) => window.clearInterval(id),
  }
}

/**
 * Invisible app-lifetime host: 30s schedule tick + focus/visibility recheck,
 * catalog load on mount, session-watch sampling, and DEV e2e `automationTick`.
 *
 * Mount once under AppLayout when `AUTOMATION_PAGE` is on (alongside
 * WindowLifecycleHost). Renders null.
 */
export function AutomationRunHost({
  tickMs = AUTOMATION_TICK_MS,
  clock: clockPartial,
  fireOnMount = true,
}: AutomationRunHostProps = {}) {
  const clockRef = useRef<AutomationRunHostClock>({
    ...defaultClock(),
    ...clockPartial,
  })
  // Keep latest injectable clock without re-binding listeners every render.
  clockRef.current = { ...defaultClock(), ...clockPartial }

  const tick = useCallback((forcedNow?: number) => {
    const now = forcedNow ?? clockRef.current.nowMs()
    const coldStart = coldStartPending
    if (coldStartPending) coldStartPending = false
    automationHostTick(now, { coldStart })
  }, [])

  // Ensure catalog/runs are loaded even when AutomationsPage never opens.
  useEffect(() => {
    if (!useAutomationStore.getState().loaded) {
      void useAutomationStore.getState().load()
    }
  }, [])

  // Interval + focus / visibility immediate check (webview timer throttle mitigation).
  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    const schedule = () => {
      if (cancelled) return
      intervalId = clockRef.current.setInterval(() => {
        tick()
      }, tickMs)
    }

    const onFocus = () => tick()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    // First tick after load so cold-start miss uses app_was_quit against catalog.
    void (async () => {
      if (!useAutomationStore.getState().loaded) {
        try {
          await useAutomationStore.getState().load()
        } catch {
          /* load already sets error; still allow ticks */
        }
      }
      if (cancelled) return
      if (fireOnMount) tick()
      schedule()
    })()

    return () => {
      cancelled = true
      if (intervalId != null) clockRef.current.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [tick, tickMs, fireOnMount])

  // DEV e2e: force a tick without waiting 30s (PR7 may drive due via this hook).
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Production app builds must not expose inject surface (mirrors sessionService).
    if (import.meta.env.PROD) return

    const install = () => {
      const hooks = window.__hipE2E
      if (!hooks) return
      hooks.automationTick = (now?: number) => {
        tick(now)
      }
    }

    install()
    // sessionService may install __hipE2E after this host mounts — re-patch briefly.
    const id = window.setInterval(install, 250)
    // Stop re-patching once the hook is present (or after a short window).
    const stop = window.setTimeout(() => window.clearInterval(id), 10_000)

    return () => {
      window.clearInterval(id)
      window.clearTimeout(stop)
      if (window.__hipE2E?.automationTick) {
        delete window.__hipE2E.automationTick
      }
    }
  }, [tick])

  return null
}
