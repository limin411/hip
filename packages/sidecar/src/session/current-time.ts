/**
 * Format current wall-clock context for model prompts.
 *
 * Minute precision keeps system prompts stable within a minute (better for
 * prompt cache / epoch reconcile) while still anchoring "today" and relative time.
 */

export function floorToMinute(date: Date): Date {
  const d = new Date(date.getTime())
  d.setSeconds(0, 0)
  return d
}

/** ISO string of the minute-floored instant (stable snapshot key). */
export function currentTimeIsoMinute(date: Date = new Date()): string {
  return floorToMinute(date).toISOString()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatYmdHmsLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

function formatYmdHmsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  )
}

/** e.g. UTC+8, UTC-5, UTC+5:30 */
export function formatUtcOffset(date: Date): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${pad2(m)}`
}

/**
 * Model-visible time block.
 *
 * Example:
 *   Current local time: 2026-07-25 15:30:00 (Asia/Shanghai, UTC+8).
 *   UTC: 2026-07-25 07:30:00.
 */
export function formatCurrentTimeText(date: Date = new Date()): string {
  const floored = floorToMinute(date)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  const offset = formatUtcOffset(floored)
  const local = formatYmdHmsLocal(floored)
  const utc = formatYmdHmsUtc(floored)
  return `Current local time: ${local} (${tz}, ${offset}).\nUTC: ${utc}.`
}
