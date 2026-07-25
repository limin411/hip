import { compareWorkItems } from './sort'
import { ensureScheduleDates } from './schedule'
import { colorKeyForItem, type WorkItemStatusColorKey } from './statusColors'
import type { WorkItem } from './types'

export type MonthCell = {
  y: number
  m: number // 0-based
  d: number
  out: boolean
  ymd: string
}

export type BarKind = 'single' | 'start' | 'mid' | 'end'

export type DayBar = {
  itemId: string
  kind: BarKind
  title: string
  colorKey: WorkItemStatusColorKey | 'cancelled'
  done: boolean
  archived: boolean
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function ymdFromParts(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`
}

/** Sunday-first month grid (at least 42 cells). */
export function buildMonthMatrix(year: number, monthIndex: number): MonthCell[] {
  const first = new Date(year, monthIndex, 1)
  const startPad = first.getDay() // Sun=0
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const cells: MonthCell[] = []
  const prevDays = new Date(year, monthIndex, 0).getDate()

  for (let i = 0; i < startPad; i++) {
    const d = prevDays - startPad + 1 + i
    const m = monthIndex === 0 ? 11 : monthIndex - 1
    const y = monthIndex === 0 ? year - 1 : year
    cells.push({ y, m, d, out: true, ymd: ymdFromParts(y, m, d) })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      y: year,
      m: monthIndex,
      d,
      out: false,
      ymd: ymdFromParts(year, monthIndex, d),
    })
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const i = cells.length - (startPad + daysInMonth)
    const d = i + 1
    const m = monthIndex === 11 ? 0 : monthIndex + 1
    const y = monthIndex === 11 ? year + 1 : year
    cells.push({ y, m, d, out: true, ymd: ymdFromParts(y, m, d) })
    if (cells.length >= 42 && cells.length % 7 === 0) break
  }
  return cells
}

/** Day arithmetic using noon local to avoid DST edge issues. */
export function addDaysYmd(ymd: string, n: number): string {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(5, 7))
  const d = Number(ymd.slice(8, 10))
  const dt = new Date(y, m - 1, d, 12, 0, 0)
  dt.setDate(dt.getDate() + n)
  return ymdFromParts(dt.getFullYear(), dt.getMonth(), dt.getDate())
}

export function daysBetweenYmd(a: string, b: string): number {
  const da = new Date(`${a}T12:00:00`)
  const db = new Date(`${b}T12:00:00`)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

export const MAX_BARS_DESKTOP = 3
export const MAX_BARS_NARROW = 2

/**
 * Place multi-day bars into day cells for a visible month.
 * Caller supplies already-filtered items; search is ignored (calendar).
 */
export function placeBarsForMonth(
  items: readonly WorkItem[],
  monthYear: number,
  monthIndex: number,
  todayYmd: string,
): Map<string, DayBar[]> {
  const cells = buildMonthMatrix(monthYear, monthIndex)
  const ymds = new Set(cells.map((c) => c.ymd))
  const byDate = new Map<string, DayBar[]>()

  const sorted = [...items].sort(compareWorkItems)

  for (const item of sorted) {
    const { startOn, endOn } = ensureScheduleDates(item, todayYmd)
    const span = daysBetweenYmd(startOn, endOn)
    const colorKey = colorKeyForItem(item)
    const done = item.status === 'done'
    const archived = item.archivedAt != null

    for (let i = 0; i <= span; i++) {
      const date = addDaysYmd(startOn, i)
      if (!ymds.has(date)) continue
      let kind: BarKind = 'single'
      if (span > 0) {
        if (i === 0) kind = 'start'
        else if (i === span) kind = 'end'
        else kind = 'mid'
      }
      const bar: DayBar = {
        itemId: item.id,
        kind,
        title: item.title,
        colorKey,
        done,
        archived,
      }
      const list = byDate.get(date)
      if (list) list.push(bar)
      else byDate.set(date, [bar])
    }
  }

  return byDate
}

export function formatMonthLabel(year: number, monthIndex: number, locale = 'zh-CN'): string {
  const d = new Date(year, monthIndex, 1)
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(d)
  } catch {
    return `${year}-${pad2(monthIndex + 1)}`
  }
}
