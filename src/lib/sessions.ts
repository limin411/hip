import type { MockSession } from '@/mock/types'

export function filterSessions(sessions: MockSession[], query: string): MockSession[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter(
    (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
  )
}
