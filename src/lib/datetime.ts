/** Relative-time units ordered by ascending limit (most fine-grained first); the last entry (Infinity) always matches. */
const REL_UNITS: { limit: number; div: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60_000, div: 1_000, unit: 'second' },
  { limit: 3_600_000, div: 60_000, unit: 'minute' },
  { limit: 86_400_000, div: 3_600_000, unit: 'hour' },
  { limit: Infinity, div: 86_400_000, unit: 'day' },
]

/** Locale-aware time-of-day (e.g. "14:30" or "2:30 PM" depending on locale). */
export function formatClockTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ms)
}

/** Full date + short time for a tooltip, e.g. "Jun 9, 2026, 2:30 PM". */
export function formatAbsolute(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

/** Relative time, e.g. "now" / "2 minutes ago" / "yesterday". `now` injectable for tests. Relies on numeric:'auto' so a 0-value renders "now". */
export function formatRelativeTime(ms: number, locale: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const u = REL_UNITS.find((x) => diff < x.limit)!
  const value = Math.floor(diff / u.div)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-value, u.unit)
}
