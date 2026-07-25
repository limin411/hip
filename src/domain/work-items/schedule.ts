import { isValidDueOn, normalizeScheduleRange } from './normalize'

/**
 * Ensure a work item always has a valid start/end schedule.
 * Missing sides default to `todayYmd` (local YYYY-MM-DD).
 * Inverted ranges are swapped (via normalizeScheduleRange).
 */
export function ensureScheduleDates(
  raw: {
    startOn?: string | null
    endOn?: string | null
    dueOn?: string | null
  },
  todayYmd: string,
): { startOn: string; endOn: string } {
  const today = isValidDueOn(todayYmd) ? todayYmd : todayYmd
  const { startOn, endOn } = normalizeScheduleRange({
    startOn: raw.startOn,
    endOn: raw.endOn,
    dueOn: raw.dueOn,
  })
  let start = startOn ?? endOn ?? today
  let end = endOn ?? startOn ?? today
  if (start > end) {
    const tmp = start
    start = end
    end = tmp
  }
  return { startOn: start, endOn: end }
}

/**
 * True when schedule is only the automatic create default (both ends = today).
 * Used by empty-shell discard so default dates alone are not "extras".
 */
export function isDefaultScheduleOnly(
  startOn: string | null | undefined,
  endOn: string | null | undefined,
  todayYmd: string,
): boolean {
  if (startOn == null && endOn == null) return true
  const ensured = ensureScheduleDates({ startOn, endOn }, todayYmd)
  return ensured.startOn === todayYmd && ensured.endOn === todayYmd
}
