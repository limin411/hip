import type { SessionConfig } from '@hip/protocol'

// 仅依赖 title/preview 两个展示字段，对 MockSession / SessionVM 通用
export function filterSessions<T extends { title: string; preview: string }>(sessions: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q))
}

/** The surface a session belongs to. The sidecar stamps `config.surface`; a missing value
 *  (only a transient/edge case) is treated as 'code', the fuller surface. */
export function surfaceOf(config: Pick<SessionConfig, 'surface'>): 'chat' | 'code' {
  return config.surface === 'chat' || config.surface === 'code' ? config.surface : 'code'
}

/** Keep only the sessions belonging to `surface`. Generic over anything carrying a config.surface. */
export function filterBySurface<T extends { config: Pick<SessionConfig, 'surface'> }>(
  sessions: T[],
  surface: 'chat' | 'code',
): T[] {
  return sessions.filter((s) => surfaceOf(s.config) === surface)
}

export type DateGroupKey = 'today' | 'yesterday' | 'older'

export function groupSessionsByRelativeDate<T extends { updatedAtMs: number }>(
  sessions: T[],
  now: number = Date.now(),
): { key: DateGroupKey; sessions: T[] }[] {
  const dayStart = (ms: number): number => {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  const todayStart = dayStart(now)
  const yesterdayDate = new Date(todayStart)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStart = yesterdayDate.getTime()

  const groups: Record<DateGroupKey, T[]> = { today: [], yesterday: [], older: [] }
  for (const s of sessions) {
    const start = dayStart(s.updatedAtMs)
    if (start === todayStart) groups.today.push(s)
    else if (start === yesterdayStart) groups.yesterday.push(s)
    else groups.older.push(s)
  }

  const result: { key: DateGroupKey; sessions: T[] }[] = []
  if (groups.today.length) result.push({ key: 'today', sessions: groups.today })
  if (groups.yesterday.length) result.push({ key: 'yesterday', sessions: groups.yesterday })
  if (groups.older.length) result.push({ key: 'older', sessions: groups.older })
  return result
}
