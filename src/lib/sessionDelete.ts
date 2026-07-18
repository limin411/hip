/**
 * Session hard-delete audit helpers (UI side).
 * Sidecar mirrors `reason` into always-on INFO logs under [session-delete].
 */

export type SessionDeleteReason =
  | 'user'
  | 'clearAll'
  | 'worktree-cascade'
  | 'worktree-menu'
  | 'cli'
  | 'unknown'

export interface DeleteSessionOpts {
  deleteDerivedMemories?: boolean
  reason?: SessionDeleteReason | string
  /** Extra fields for logs only (paths, filter, etc.). */
  meta?: Record<string, unknown>
}

/** Always emit a structured console line so DevTools / dogfood traces catch wipes. */
export function auditSessionDelete(
  phase: 'request' | 'skip' | 'batch-start' | 'batch-done',
  data: Record<string, unknown>,
): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[hip][session-delete] ${phase}`, data)
  } catch {
    /* never throw from logging */
  }
}

export function debugSessionDelete(msg: string, data?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.debug(`[hip][session-delete] ${msg}`, data ?? {})
  } catch {
    /* never throw from logging */
  }
}
