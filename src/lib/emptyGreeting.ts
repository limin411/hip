/**
 * Locale-aware empty-state greeting selector (pure).
 * Inputs: local clock + IANA TZ + UI language + surface + optional tip anti-repeat ids.
 */

import type { AppLanguage } from '@/store/uiStore'
import {
  EMPTY_GREETING,
  type Surface,
} from './emptyGreeting.keys'
import {
  matchHoliday,
  type CalendarRegion,
  type LocalDateParts,
} from './emptyGreeting.holidays'

export type { Surface } from './emptyGreeting.keys'
export type { CalendarRegion } from './emptyGreeting.holidays'

/**
 * Fine-grained local time slots for copy + cache invalidation.
 * Night is split so Sunday 23:xx ≠ Monday 02:xx ≠ weekday evening.
 */
export type TimeOfDay =
  | 'earlyMorning'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'lateEvening'
  | 'lateNight'
  | 'deepNight'

/** Calendar-edge moments that need special tone (e.g. 周日深夜 → 周一凌晨). */
export type WeekEdge = 'none' | 'sunday-evening' | 'sunday-late' | 'monday-early'

export type GreetingTier = 'holiday' | 'weekend' | 'weekEdge' | 'timeOfDay' | 'default'

export interface EmptyGreetingContext {
  now: Date
  timeZone: string
  language: AppLanguage
  surface: Surface
  /** Anti-repeat window for tip ids only */
  recentTipIds?: string[]
  /** Injected for tests; production tip pick uses daily hash when omitted */
  rng?: () => number
}

export interface EmptyGreetingPick {
  id: string
  tier: GreetingTier
  tipId?: string
  titleKey: string
  subKey: string
  region: CalendarRegion
  timeOfDay: TimeOfDay
  /** Local hour 0–23 (for LLM tone + cache). */
  localHour: number
  /** 0=Sun … 6=Sat */
  weekday: number
  weekEdge: WeekEdge
}

/** Weekend title probability via daily hash (locked). */
export const WEEKEND_TITLE_P = 0.25

const WEEKDAY_EN: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** CJK language locks calendar; only Taipei overrides zh-CN in v1. */
const CJK_TZ_OVERRIDES: Record<string, CalendarRegion> = {
  'Asia/Taipei': 'TW',
}

/**
 * Exact IANA allowlist for English UI (never America/*).
 * Unlisted zones intentionally map to GENERIC.
 */
const TZ_TO_REGION_EN: Record<string, CalendarRegion> = {
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'America/Honolulu': 'US',
  'America/Boise': 'US',
  'America/Indiana/Indianapolis': 'US',
  'America/Detroit': 'US',
  'Pacific/Honolulu': 'US',
  'Europe/London': 'GB',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Australia/Hobart': 'AU',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Chongqing': 'CN',
  'Asia/Urumqi': 'CN',
  'Asia/Taipei': 'TW',
}

export function resolveSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function localParts(now: Date, timeZone: string): LocalDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  })
  const parts = dtf.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((p) => p.type === type)?.value

  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const weekdayStr = get('weekday') ?? 'Sun'
  const weekday = WEEKDAY_EN[weekdayStr] ?? 0

  return { year, month, day, hour, weekday }
}

export function timeOfDayBucket(hour: number): TimeOfDay {
  const h = ((hour % 24) + 24) % 24
  if (h >= 5 && h <= 7) return 'earlyMorning'
  if (h >= 8 && h <= 11) return 'morning'
  if (h >= 12 && h <= 17) return 'afternoon'
  if (h >= 18 && h <= 20) return 'evening'
  if (h >= 21 && h <= 22) return 'lateEvening'
  // 23, 0, 1 — late night / approaching next calendar day
  if (h === 23 || h <= 1) return 'lateNight'
  // 2, 3, 4
  return 'deepNight'
}

/**
 * Special week-edge moments for more careful copy.
 * weekday: 0=Sun … 6=Sat (JS convention).
 */
export function resolveWeekEdge(weekday: number, hour: number): WeekEdge {
  const h = ((hour % 24) + 24) % 24
  // Sunday evening: weekend winding down, Monday on the horizon
  if (weekday === 0 && h >= 18 && h <= 22) return 'sunday-evening'
  // Sunday 23:xx — almost Monday
  if (weekday === 0 && h === 23) return 'sunday-late'
  // Monday 0–5 — new week, still dark
  if (weekday === 1 && h <= 5) return 'monday-early'
  return 'none'
}

export function resolveCalendarRegion(
  language: AppLanguage,
  timeZone: string,
): CalendarRegion {
  if (language === 'zh-TW') return 'TW'
  if (language === 'zh-CN') {
    return CJK_TZ_OVERRIDES[timeZone] ?? 'CN'
  }
  return TZ_TO_REGION_EN[timeZone] ?? 'GENERIC'
}

export function dayKey(parts: Pick<LocalDateParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Cache bucket for timely invalidation: day + hour slot (1h) + weekEdge. */
export function timeCacheBucket(parts: LocalDateParts, weekEdge: WeekEdge): string {
  return `${dayKey(parts)}@${parts.hour}|${weekEdge}`
}

/** Stable [0,1) from dayKey + salt — no Math.random on production weekend gate. */
export function dailyUnit(key: string, salt: string): number {
  const s = `${key}|${salt}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 0x1_0000_0000
}

function pickTipSub(
  ctx: EmptyGreetingContext,
): { id: string; subKey: string } | null {
  const pool = Object.values(EMPTY_GREETING.tip).filter((t) =>
    (t.surfaces as readonly Surface[]).includes(ctx.surface),
  )
  const recent = new Set(ctx.recentTipIds ?? [])
  const fresh = pool.filter((t) => !recent.has(t.id))
  const list = fresh.length > 0 ? fresh : pool
  if (list.length === 0) return null

  const parts = localParts(ctx.now, ctx.timeZone)
  const unit = (ctx.rng ?? (() => dailyUnit(dayKey(parts), 'tip')))()
  const idx = Math.floor(unit * list.length) % list.length
  const chosen = list[idx]!
  return { id: chosen.id, subKey: chosen.sub }
}

function withTimeMeta(
  pick: Omit<EmptyGreetingPick, 'localHour' | 'weekday' | 'weekEdge'>,
  parts: LocalDateParts,
  weekEdge: WeekEdge,
): EmptyGreetingPick {
  return {
    ...pick,
    localHour: parts.hour,
    weekday: parts.weekday,
    weekEdge,
  }
}

/**
 * Selection ladder:
 * 1. Holiday full pair (code surface may swap sub for a code tip)
 * 2. Week-edge specials (Sun evening/late, Mon early) — beat generic weekend/TOD
 * 3. Title = weekend (p=0.25 daily hash on Sat/Sun only if not week-edge) or time-of-day
 * 4. Sub = tip (anti-repeat) else TOD/weekend/weekEdge sub
 */
export function selectEmptyGreeting(ctx: EmptyGreetingContext): EmptyGreetingPick {
  const parts = localParts(ctx.now, ctx.timeZone)
  const region = resolveCalendarRegion(ctx.language, ctx.timeZone)
  const tod = timeOfDayBucket(parts.hour)
  const weekEdge = resolveWeekEdge(parts.weekday, parts.hour)
  const holiday = matchHoliday(region, parts)

  if (holiday) {
    const keys = EMPTY_GREETING.holiday[holiday.id]
    let subKey: string = keys.sub
    let tipId: string | undefined
    if (ctx.surface === 'code') {
      const tip = pickTipSub(ctx)
      if (tip) {
        subKey = tip.subKey
        tipId = tip.id
      }
    }
    return withTimeMeta(
      {
        id: keys.id,
        tier: 'holiday',
        tipId,
        titleKey: keys.title,
        subKey,
        region,
        timeOfDay: tod,
      },
      parts,
      weekEdge,
    )
  }

  // Sunday night → Monday dawn: dedicated pairs (more careful than generic weekend/night).
  if (weekEdge !== 'none') {
    const edgeKeys = EMPTY_GREETING.weekEdge[weekEdge]
    const tip = pickTipSub(ctx)
    if (tip) {
      return withTimeMeta(
        {
          id: `weekEdge:${weekEdge}+${tip.id}`,
          tier: 'weekEdge',
          tipId: tip.id,
          titleKey: edgeKeys.title,
          subKey: tip.subKey,
          region,
          timeOfDay: tod,
        },
        parts,
        weekEdge,
      )
    }
    return withTimeMeta(
      {
        id: `weekEdge:${weekEdge}`,
        tier: 'weekEdge',
        titleKey: edgeKeys.title,
        subKey: edgeKeys.sub,
        region,
        timeOfDay: tod,
      },
      parts,
      weekEdge,
    )
  }

  const isWe = parts.weekday === 0 || parts.weekday === 6
  const useWeekendTitle =
    isWe && dailyUnit(dayKey(parts), 'weekend-title') < WEEKEND_TITLE_P

  const titleKey = useWeekendTitle
    ? EMPTY_GREETING.weekend.title
    : EMPTY_GREETING.tod[tod].title
  const tier: GreetingTier = useWeekendTitle ? 'weekend' : 'timeOfDay'
  const titleId = useWeekendTitle ? 'weekend' : `tod:${tod}`

  const tip = pickTipSub(ctx)
  if (tip) {
    return withTimeMeta(
      {
        id: `${titleId}+${tip.id}`,
        tier,
        tipId: tip.id,
        titleKey,
        subKey: tip.subKey,
        region,
        timeOfDay: tod,
      },
      parts,
      weekEdge,
    )
  }

  const subKey = useWeekendTitle
    ? EMPTY_GREETING.weekend.sub
    : EMPTY_GREETING.tod[tod].sub

  return withTimeMeta(
    {
      id: titleId,
      tier,
      titleKey,
      subKey,
      region,
      timeOfDay: tod,
    },
    parts,
    weekEdge,
  )
}
