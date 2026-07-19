/**
 * sessionStorage I/O for empty-greeting tip anti-repetition.
 * Pure selector only filters injected recentTipIds — this module owns storage.
 */

const RECENT_KEY = 'hip-empty-greeting-recent'
const RECENT_CAP = 8

function parseTipIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, RECENT_CAP)
  } catch {
    return []
  }
}

export function readRecentTipIds(): string[] {
  try {
    if (typeof sessionStorage === 'undefined') return []
    return parseTipIds(sessionStorage.getItem(RECENT_KEY))
  } catch {
    return []
  }
}

export function pushRecentTipId(tipId: string): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    const next = [tipId, ...readRecentTipIds().filter((x) => x !== tipId)].slice(0, RECENT_CAP)
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // private mode / blocked storage
  }
}

/** Test helper — clears the recent tip list. */
export function clearRecentTipIds(): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.removeItem(RECENT_KEY)
  } catch {
    // ignore
  }
}
