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
