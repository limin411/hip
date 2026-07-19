/**
 * Resolve which session to select when the user opens a worktree row (D10).
 */
import { pathKey } from '@/lib/worktreeNesting'

export type WorktreeOpenTarget =
  | { kind: 'select'; sessionId: string }
  | { kind: 'none'; reason: 'agent_task_only' | 'no_session' | 'primary' }

export function resolveWorktreeOpenTarget(input: {
  path: string
  /** Explicit host for primary / fallback select — required parameter, not prose-only. */
  hostSessionId: string
  isPrimary?: boolean
  /** From parallel slot when known */
  slotSessionId?: string
  slotTaskId?: string
  /** Meta field if sidecar ever writes it — unused in UI today */
  boundSessionId?: string
  /**
   * Domain sessions. `status` / `updatedAtMs` match sessionStore when present.
   * Both optional: missing status → not running; missing updatedAtMs → skip recency.
   */
  sessions: Array<{
    id: string
    title: string
    config: { cwd?: string }
    status?: 'idle' | 'running' | 'error' | string
    updatedAtMs?: number
  }>
  nestedSessionIds: Set<string>
}): WorktreeOpenTarget {
  const sessionIds = new Set(input.sessions.map((s) => s.id))

  // 1. Primary → select host
  if (input.isPrimary) {
    if (input.hostSessionId && sessionIds.has(input.hostSessionId)) {
      return { kind: 'select', sessionId: input.hostSessionId }
    }
    // Host missing from sessions list — still prefer host id if provided
    if (input.hostSessionId) {
      return { kind: 'select', sessionId: input.hostSessionId }
    }
    return { kind: 'none', reason: 'primary' }
  }

  // 2. Explicit slot session
  if (input.slotSessionId && sessionIds.has(input.slotSessionId)) {
    return { kind: 'select', sessionId: input.slotSessionId }
  }

  // 3. boundSessionId (future)
  if (input.boundSessionId && sessionIds.has(input.boundSessionId)) {
    return { kind: 'select', sessionId: input.boundSessionId }
  }

  // 4. Among sessions with matching cwd
  const targetKey = pathKey(input.path)
  const matches = input.sessions.filter(
    (s) => s.config.cwd && pathKey(s.config.cwd) === targetKey,
  )

  if (matches.length > 0) {
    const nested = matches.filter((s) => input.nestedSessionIds.has(s.id))
    const pool = nested.length > 0 ? nested : matches

    const running = pool.filter((s) => s.status === 'running')
    let candidates = running.length > 0 ? running : pool

    const anyRecency = candidates.some((s) => typeof s.updatedAtMs === 'number')
    if (anyRecency) {
      candidates = [...candidates].sort((a, b) => {
        const am = a.updatedAtMs ?? -Infinity
        const bm = b.updatedAtMs ?? -Infinity
        if (bm !== am) return bm - am
        return a.id.localeCompare(b.id)
      })
    } else {
      candidates = [...candidates].sort((a, b) => a.id.localeCompare(b.id))
    }

    return { kind: 'select', sessionId: candidates[0]!.id }
  }

  // 5. Agent HITL background worker only
  if (input.slotTaskId && !input.slotSessionId) {
    return { kind: 'none', reason: 'agent_task_only' }
  }

  // 6. No session at path
  return { kind: 'none', reason: 'no_session' }
}
