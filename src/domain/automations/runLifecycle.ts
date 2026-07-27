import type {
  AutomationRun,
  AutomationSessionKind,
  AutomationSessionSnapshot,
} from './types'

/** Per-automation cap before global truncate. */
export const PER_AUTO_RUNS_MAX = 50

/** Global runs.json cap after per-auto filter. */
export const GLOBAL_RUNS_MAX = 500

/**
 * Classify a live session for automation completion (normative predicate).
 *
 * Order matters:
 * 1. missing session → failed
 * 2. status === 'error' → failed
 * 3. HITL (`pendingPermission` || `interrupt` || `planApprovalPending`) → waiting_user
 *    — checked **before** status === 'running' because ACP `permission:request`
 *    keeps status 'running' with pendingPermission set
 * 4. status === 'running' → in_flight
 * 5. else (typically idle, no HITL) → succeeded
 *
 * `waiting_user` is **not** terminal for per-auto claim release.
 */
export function classifySessionForAutomation(
  s: AutomationSessionSnapshot | undefined | null,
): AutomationSessionKind {
  if (!s) return 'failed'
  if (s.status === 'error') return 'failed'
  // HITL first — any truthy field, regardless of status.
  if (s.pendingPermission || s.interrupt || s.planApprovalPending) {
    return 'waiting_user'
  }
  if (s.status === 'running') return 'in_flight'
  return 'succeeded'
}

/**
 * Truncate runs history (normative):
 * 1) Per-automation: keep newest `PER_AUTO_RUNS_MAX` by startedAt
 * 2) Global: keep newest `GLOBAL_RUNS_MAX` overall
 *
 * Two sequential filters (not OR). Stable for empty input.
 */
export function truncateRuns(runs: AutomationRun[]): AutomationRun[] {
  if (runs.length === 0) return []

  const byAuto = new Map<string, AutomationRun[]>()
  for (const r of runs) {
    const list = byAuto.get(r.automationId) ?? []
    list.push(r)
    byAuto.set(r.automationId, list)
  }

  const kept: AutomationRun[] = []
  for (const list of byAuto.values()) {
    list.sort((a, b) => b.startedAt - a.startedAt)
    kept.push(...list.slice(0, PER_AUTO_RUNS_MAX))
  }

  kept.sort((a, b) => b.startedAt - a.startedAt)
  return kept.slice(0, GLOBAL_RUNS_MAX)
}

/** Session title prefix used before send so tray notifications are readable. */
export function formatAutomationSessionTitle(name: string): string {
  const trimmed = name.trim() || 'Automation'
  return `⏱ ${trimmed}`
}
