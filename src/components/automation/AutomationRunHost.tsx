import { useCallback, useEffect, useRef } from 'react'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useAutomationStore } from '@/store/automationStore'
import { listenAutomationTick } from '@/ipc/automations'
import { automationHostTick } from './automationScheduleTick'

/**
 * Failsafe cadence, used **only** when the native ticker cannot be subscribed
 * (no Tauri IPC — e.g. these shell assets opened in a plain browser).
 */
export const WEBVIEW_FALLBACK_TICK_MS = 30_000

export type AutomationRunHostClock = {
  /** Injectable wall clock (tests). Default `Date.now`. */
  nowMs: () => number
  /**
   * Subscribe to schedule ticks; returns an unsubscribe function.
   * Default: the native `automation://tick` event owned by the Rust runtime.
   */
  subscribeTicks: (handler: () => void) => Promise<UnlistenFn>
}

export type AutomationRunHostProps = {
  /** Injectable clock + tick source so unit tests never sleep 30s. */
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
    subscribeTicks: listenAutomationTick,
  }
}

/**
 * Invisible app-lifetime host: native schedule tick + focus/visibility recheck,
 * catalog load on mount, session-watch sampling, and DEV e2e `automationTick`.
 *
 * Mounted unconditionally under AppLayout (alongside WindowLifecycleHost) —
 * this is the *only* thing that fires scheduled automations, and the composer's
 * scheduled-task UI depends on it even while `AUTOMATION_PAGE` is off.
 * Do not gate it on `AUTOMATION_PAGE`. Renders null.
 */
export function AutomationRunHost({
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
    // Do not evaluate schedules or burn coldStart until catalog is loaded.
    // focus/visibility can fire while load() IPC is in flight (empty catalog).
    if (!useAutomationStore.getState().loaded) return
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

  // Native tick source + focus / visibility immediate check.
  useEffect(() => {
    let cancelled = false
    let unlisten: UnlistenFn | null = null
    let fallbackId: number | null = null

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
          /* load already sets error; still allow ticks once loaded flips */
        }
      }
      if (cancelled) return
      if (fireOnMount) tick()

      try {
        const stop = await clockRef.current.subscribeTicks(() => tick())
        if (cancelled) stop()
        else unlisten = stop
      } catch {
        // No native ticker (not running under the Tauri shell). Fall back to a
        // webview timer so the schedule still advances — throttled while the
        // window is hidden, which is why the native ticker owns this in prod.
        if (!cancelled) {
          fallbackId = window.setInterval(() => tick(), WEBVIEW_FALLBACK_TICK_MS)
        }
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
      if (fallbackId != null) window.clearInterval(fallbackId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [tick, fireOnMount])

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
