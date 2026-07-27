/**
 * Normative onTick + watch sampling for AutomationRunHost.
 * Pure store-facing helpers — no React / no timers (injectable from host).
 *
 * Design: docs/design/2026-07-27-automation-page.md
 */
import {
  classifySessionForAutomation,
  computeNextRunAt,
  evaluateSchedule,
} from '@/domain/automations'
import { useDomainStore } from '@/domain/sessionStore'
import { listWatches, useAutomationStore } from '@/store/automationStore'

export type AutomationTickOpts = {
  /**
   * First tick after process launch (post-load): lag ≥ 6h → `app_was_quit`.
   * Mid-session long lag → `missed_over_6h`.
   */
  coldStart?: boolean
}

/**
 * Evaluate enabled scheduled automations and fire / skip as due.
 * `void runNow` is OK: tryClaimInFlight is sync; enqueueRunNow serializes bodies.
 */
export function runAutomationOnTick(
  nowMs: number,
  opts: AutomationTickOpts = {},
): void {
  const store = useAutomationStore.getState()
  const enabled = store.automations.filter(
    (a) => a.enabled && a.trigger.kind !== 'manual',
  )

  for (const a of enabled) {
    // Seed missing nextRunAt then wait for a later tick (design evaluateSchedule).
    if (a.nextRunAt == null) {
      const next = computeNextRunAt(a.trigger, nowMs)
      void store.patchNextRunAt(a.id, next)
      continue
    }

    const decision = evaluateSchedule({
      nextRunAt: a.nextRunAt,
      nowMs,
      coldStart: opts.coldStart,
    })

    if (decision.action === 'noop') continue

    if (decision.action === 'skip_miss') {
      void store.recordSkip(a.id, {
        trigger: 'catchup',
        error: decision.reason ?? 'missed_over_6h',
        now: nowMs,
        rollNextRunAt: true,
      })
      continue
    }

    void store.runNow(a.id, {
      focus: false,
      trigger: decision.action === 'fire_catchup' ? 'catchup' : 'schedule',
      nowMs,
    })
  }
}

/**
 * Sample open watches against domain sessions and complete / patch waiting_user.
 * Call on each host tick so schedule/manual fires reach a terminal status.
 *
 * Unloaded list summaries always look `idle` without HITL — not trustworthy for
 * terminal success (same guard as recoverOrphanRuns). Leave the watch open.
 */
export function sampleAutomationWatches(nowMs: number = Date.now()): void {
  const store = useAutomationStore.getState()
  const sessions = useDomainStore.getState().sessions

  for (const w of listWatches()) {
    const session = sessions.find((s) => s.id === w.sessionId)

    // Mirror recover: unloaded summaries must not complete as succeeded.
    if (session && session.loaded === false) {
      continue
    }

    const kind = classifySessionForAutomation(session)

    if (kind === 'in_flight') continue

    if (kind === 'waiting_user') {
      const run = store.runs.find((r) => r.id === w.runId)
      if (run && run.status !== 'waiting_user') {
        void store.patchRunStatus(w.runId, 'waiting_user')
      }
      continue
    }

    void store.completeRun(w.runId, {
      status: kind === 'succeeded' ? 'succeeded' : 'failed',
      error:
        kind === 'failed'
          ? session?.error?.message ||
            session?.error?.code ||
            'session_error'
          : null,
      finishedAt: nowMs,
    })
  }
}

/** Full host tick body: sample watches then evaluate schedules. */
export function automationHostTick(
  nowMs: number,
  opts: AutomationTickOpts = {},
): void {
  sampleAutomationWatches(nowMs)
  runAutomationOnTick(nowMs, opts)
}
