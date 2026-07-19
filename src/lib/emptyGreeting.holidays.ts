/**
 * Curated holiday registry for empty-state greetings.
 * Lunar anchors are hand-maintained Gregorian dates — refresh when CI fails.
 */

import type { HolidayKey } from './emptyGreeting.keys'

/** v1 regions with at least one holiday (or GENERIC). */
export type CalendarRegion = 'CN' | 'TW' | 'JP' | 'US' | 'GB' | 'AU' | 'GENERIC'

export type HolidayMatch =
  | {
      type: 'fixed'
      month: number
      day: number
      endMonth?: number
      endDay?: number
    }
  | {
      type: 'nthWeekday'
      month: number
      weekday: number
      nth: number
    }
  | {
      type: 'anchors'
      anchorId: string
      /** Inclusive days after anchor day 0 (anchor date itself). */
      spanDays: number
      /** Days before anchor included (e.g. 1 = eve). */
      leadDays?: number
    }

export interface HolidayDef {
  id: HolidayKey
  regions: CalendarRegion[]
  match: HolidayMatch
  kind: 'public' | 'cultural'
}

export interface LocalDateParts {
  year: number
  month: number
  day: number
  hour: number
  weekday: number
}

/**
 * Hand-maintained Gregorian dates for floating festivals.
 * Maintainer: refresh when emptyGreeting.holidays.test.ts fails.
 * After max year: festival simply does not match (TOD path still works).
 */
export const LUNAR_ANCHORS: Record<
  string,
  ReadonlyArray<{ year: number; month: number; day: number }>
> = {
  'spring-festival': [
    { year: 2025, month: 1, day: 29 },
    { year: 2026, month: 2, day: 17 },
    { year: 2027, month: 2, day: 6 },
    { year: 2028, month: 1, day: 26 },
    { year: 2029, month: 2, day: 13 },
    { year: 2030, month: 2, day: 3 },
  ],
  'mid-autumn': [
    { year: 2025, month: 10, day: 6 },
    { year: 2026, month: 9, day: 25 },
    { year: 2027, month: 9, day: 15 },
    { year: 2028, month: 10, day: 3 },
    { year: 2029, month: 9, day: 22 },
    { year: 2030, month: 9, day: 12 },
  ],
}

/** Frozen v1 registry — 10 definitions, first match wins. */
export const HOLIDAYS: readonly HolidayDef[] = [
  {
    id: 'new-year',
    regions: ['CN', 'TW', 'JP', 'US', 'GB', 'AU', 'GENERIC'],
    match: { type: 'fixed', month: 1, day: 1 },
    kind: 'public',
  },
  {
    id: 'cn-spring-festival',
    regions: ['CN', 'TW'],
    match: {
      type: 'anchors',
      anchorId: 'spring-festival',
      leadDays: 1,
      spanDays: 2,
    },
    kind: 'public',
  },
  {
    id: 'cn-labor-day',
    regions: ['CN', 'TW'],
    match: { type: 'fixed', month: 5, day: 1 },
    kind: 'public',
  },
  {
    id: 'cn-national-day',
    regions: ['CN'],
    match: { type: 'fixed', month: 10, day: 1, endMonth: 10, endDay: 3 },
    kind: 'public',
  },
  {
    id: 'tw-national-day',
    regions: ['TW'],
    match: { type: 'fixed', month: 10, day: 10 },
    kind: 'public',
  },
  {
    id: 'cn-mid-autumn',
    regions: ['CN', 'TW'],
    match: { type: 'anchors', anchorId: 'mid-autumn', spanDays: 0 },
    kind: 'public',
  },
  {
    id: 'jp-golden-week',
    regions: ['JP'],
    match: { type: 'fixed', month: 4, day: 29, endMonth: 5, endDay: 5 },
    kind: 'public',
  },
  {
    id: 'us-independence-day',
    regions: ['US'],
    match: { type: 'fixed', month: 7, day: 4 },
    kind: 'public',
  },
  {
    id: 'us-thanksgiving',
    regions: ['US'],
    match: { type: 'nthWeekday', month: 11, weekday: 4, nth: 4 },
    kind: 'public',
  },
  {
    id: 'christmas',
    regions: ['US', 'GB', 'AU'],
    match: { type: 'fixed', month: 12, day: 25 },
    kind: 'cultural',
  },
]

/** Day-of-month for the nth weekday of a month (UTC calendar math). */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): number {
  if (nth > 0) {
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
    return 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7
  }
  // nth === -1 → last weekday of month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay()
  return lastDay - ((lastWeekday - weekday + 7) % 7)
}

function md(month: number, day: number): number {
  return month * 100 + day
}

function matchesFixed(
  parts: LocalDateParts,
  match: Extract<HolidayMatch, { type: 'fixed' }>,
): boolean {
  const cur = md(parts.month, parts.day)
  const start = md(match.month, match.day)
  const end =
    match.endMonth != null && match.endDay != null
      ? md(match.endMonth, match.endDay)
      : start
  if (start <= end) return cur >= start && cur <= end
  // Year wrap (unused in v1 registry)
  return cur >= start || cur <= end
}

function matchesNthWeekday(
  parts: LocalDateParts,
  match: Extract<HolidayMatch, { type: 'nthWeekday' }>,
): boolean {
  if (parts.month !== match.month) return false
  const day = nthWeekdayOfMonth(parts.year, match.month, match.weekday, match.nth)
  return parts.day === day
}

function matchesAnchors(
  parts: LocalDateParts,
  match: Extract<HolidayMatch, { type: 'anchors' }>,
): boolean {
  const rows = LUNAR_ANCHORS[match.anchorId]
  if (!rows) return false
  const row = rows.find((r) => r.year === parts.year)
  if (!row) return false
  const MS_DAY = 86_400_000
  const anchor = Date.UTC(row.year, row.month - 1, row.day)
  const lead = match.leadDays ?? 0
  const start = anchor - lead * MS_DAY
  const end = anchor + match.spanDays * MS_DAY
  const cur = Date.UTC(parts.year, parts.month - 1, parts.day)
  return cur >= start && cur <= end
}

export function holidayMatches(def: HolidayDef, parts: LocalDateParts): boolean {
  switch (def.match.type) {
    case 'fixed':
      return matchesFixed(parts, def.match)
    case 'nthWeekday':
      return matchesNthWeekday(parts, def.match)
    case 'anchors':
      return matchesAnchors(parts, def.match)
  }
}

/** First registry entry whose regions include `region` and whose match hits `parts`. */
export function matchHoliday(
  region: CalendarRegion,
  parts: LocalDateParts,
): HolidayDef | null {
  for (const def of HOLIDAYS) {
    if (!def.regions.includes(region)) continue
    if (holidayMatches(def, parts)) return def
  }
  return null
}
