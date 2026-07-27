import type {
  AutomationTrigger,
  ScheduleDecision,
} from './types'

/** Missed-run catch-up window: lag &lt; 6h may fire once; ≥6h → skip_miss. */
export const MISS_WINDOW_MS = 6 * 3600_000

/**
 * Within the miss window, lag ≤ this → `fire_due`; lag &gt; this → `fire_catchup`.
 * Aligns with host tick (~30s).
 */
export const DUE_SLACK_MS = 30_000

/**
 * Local calendar wall-clock → epoch ms (host timezone; no luxon).
 * Uses `Date(y, m-1, d, h, min, 0, 0)` so DST gaps/overlaps follow JS Date rules:
 * - spring-forward missing hour: constructor rolls forward (no throw)
 * - fall-back repeated hour: one concrete instant; nextRunAt still advances by day/week
 */
export function localWallTimeMs(
  year: number,
  month1to12: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return new Date(year, month1to12 - 1, day, hour, minute, 0, 0).getTime()
}

function partsLocal(ms: number): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
} {
  const d = new Date(ms)
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    weekday: d.getDay(),
  }
}

/**
 * First daily occurrence at `hour:minute` local with epoch ≥ `fromMs`.
 * If today's slot is already past, rolls to tomorrow (local date +1).
 */
export function nextDailyAt(
  hour: number,
  minute: number,
  fromMs: number,
): number {
  const p = partsLocal(fromMs)
  let candidate = localWallTimeMs(p.year, p.month, p.day, hour, minute)
  if (candidate >= fromMs) return candidate
  // Next local calendar day — Date handles month/year rollover and DST.
  const tomorrow = new Date(p.year, p.month - 1, p.day + 1, hour, minute, 0, 0)
  return tomorrow.getTime()
}

/**
 * First weekly occurrence on `weekday` (0=Sun…6=Sat) at `hour:minute` local
 * with epoch ≥ `fromMs`.
 */
export function nextWeeklyAt(
  weekday: number,
  hour: number,
  minute: number,
  fromMs: number,
): number {
  const wd = ((Math.trunc(weekday) % 7) + 7) % 7
  const p = partsLocal(fromMs)
  // Days until target weekday (0 = today)
  let delta = (wd - p.weekday + 7) % 7
  let candidate = new Date(
    p.year,
    p.month - 1,
    p.day + delta,
    hour,
    minute,
    0,
    0,
  ).getTime()
  if (candidate >= fromMs) return candidate
  // Today's slot already past → same weekday next week
  candidate = new Date(
    p.year,
    p.month - 1,
    p.day + delta + 7,
    hour,
    minute,
    0,
    0,
  ).getTime()
  return candidate
}

/**
 * Next scheduled fire time at or after `fromMs` (local TZ).
 * Manual triggers → `null` (no schedule).
 *
 * After a successful/skipped run, call with `fromMs = now` so the just-fired
 * slot is skipped when now is past that wall time.
 */
export function computeNextRunAt(
  trigger: AutomationTrigger,
  fromMs: number,
): number | null {
  if (trigger.kind === 'manual') return null
  if (trigger.kind === 'daily') {
    return nextDailyAt(trigger.hour, trigger.minute, fromMs)
  }
  return nextWeeklyAt(trigger.weekday, trigger.hour, trigger.minute, fromMs)
}

/**
 * True when `nextRunAt` is set and `nextRunAt <= now` (ready for evaluate).
 */
export function isDue(nextRunAt: number | null | undefined, nowMs: number): boolean {
  if (nextRunAt == null) return false
  return nextRunAt <= nowMs
}

export type EvaluateScheduleInput = {
  /** Current nextRunAt from catalog (null → needs seed → noop after compute) */
  nextRunAt: number | null | undefined
  trigger: AutomationTrigger
  nowMs: number
  /**
   * Cold start after process launch: lag ≥ 6h uses `app_was_quit`.
   * Mid-session long lag uses `missed_over_6h`.
   */
  coldStart?: boolean
}

/**
 * Pure schedule decision (normative evaluateSchedule from design).
 *
 * - nextRunAt null → noop (caller should seed via computeNextRunAt)
 * - nextRunAt > now → noop
 * - lag &lt; 6h and lag ≤ 30s → fire_due
 * - lag &lt; 6h and lag &gt; 30s → fire_catchup (at most one catch-up; host rolls next)
 * - lag ≥ 6h → skip_miss + reason
 *
 * Does **not** check in-flight / previous running (that is tryClaimInFlight).
 */
export function evaluateSchedule(input: EvaluateScheduleInput): ScheduleDecision {
  const { nextRunAt, nowMs, coldStart } = input
  if (nextRunAt == null) return { action: 'noop' }
  if (nextRunAt > nowMs) return { action: 'noop' }

  const lag = nowMs - nextRunAt
  if (lag < MISS_WINDOW_MS) {
    return { action: lag > DUE_SLACK_MS ? 'fire_catchup' : 'fire_due' }
  }
  return {
    action: 'skip_miss',
    reason: coldStart ? 'app_was_quit' : 'missed_over_6h',
  }
}

/**
 * After fire or skip_miss: roll nextRunAt from `nowMs` (single step; no multi-slot catch-up).
 * Manual → null.
 */
export function rollNextRunAt(
  trigger: AutomationTrigger,
  nowMs: number,
): number | null {
  return computeNextRunAt(trigger, nowMs)
}
