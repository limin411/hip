/**
 * Group project (code-surface) sessions by workspace path for the sidebar.
 */

export function projectPathKey(cwd: string | undefined | null): string {
  if (!cwd?.trim()) return ''
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Last path segment for group headers (e.g. `/a/b/hip` → `hip`). */
export function projectPathBasename(cwd: string): string {
  const key = projectPathKey(cwd)
  if (!key) return ''
  const parts = key.split('/').filter(Boolean)
  return parts[parts.length - 1] || key
}

export interface SessionProjectGroup<T> {
  /** Normalized path key; empty string = unbound / no cwd. */
  pathKey: string
  /** Display path (original when available). */
  cwd: string | null
  /** Basename label; empty when unbound. */
  label: string
  sessions: T[]
}

/**
 * Group sessions by `config.cwd` (normalized). Within each group, sessions are
 * newest-first. Groups are ordered by their newest session; unbound last.
 */
export function groupSessionsByProjectPath<
  T extends { updatedAtMs: number; config: { cwd?: string } },
>(sessions: T[]): SessionProjectGroup<T>[] {
  const map = new Map<string, { cwd: string | null; sessions: T[] }>()
  for (const s of sessions) {
    const key = projectPathKey(s.config.cwd)
    const bucket = map.get(key)
    if (bucket) {
      bucket.sessions.push(s)
    } else {
      const raw = s.config.cwd?.trim()
      map.set(key, {
        cwd: key ? (raw ? projectPathKey(raw) : key) : null,
        sessions: [s],
      })
    }
  }

  const groups: SessionProjectGroup<T>[] = []
  for (const [key, g] of map) {
    const sorted = [...g.sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    groups.push({
      pathKey: key,
      cwd: g.cwd,
      label: key ? projectPathBasename(key) : '',
      sessions: sorted,
    })
  }

  groups.sort((a, b) => {
    if (!a.pathKey && b.pathKey) return 1
    if (a.pathKey && !b.pathKey) return -1
    const aMs = a.sessions[0]?.updatedAtMs ?? 0
    const bMs = b.sessions[0]?.updatedAtMs ?? 0
    if (bMs !== aMs) return bMs - aMs
    return a.pathKey.localeCompare(b.pathKey)
  })

  return groups
}
