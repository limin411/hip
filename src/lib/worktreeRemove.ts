import type { WorktreeRemoveErrorCode } from '@hip/protocol'
import { sessionService } from '@/domain'

/**
 * Dirty detection: prefer structured `errorCode` (PR7); fall back to string match
 * for older sidecars. Matches WorktreeDirtyError message: "Worktree is dirty…".
 * No file-count parsing (D6); dirtySummary enables richer copy later.
 */
export function isWorktreeDirtyError(
  error?: string | null,
  errorCode?: WorktreeRemoveErrorCode | string | null,
): boolean {
  if (errorCode === 'WORKTREE_DIRTY') return true
  if (!error) return false
  return /dirty|uncommitted/i.test(error)
}

export interface RemoveManagedWorktreeInput {
  hostSessionId: string
  worktreePath: string
  force?: boolean
  /** Explicit parallel/catalog slot session to clean up if cascade event is missed. */
  slotSessionId?: string
  label?: string
  reason?: string
}

export type RemoveManagedWorktreeResult =
  | { ok: true }
  | {
      ok: false
      dirty: boolean
      error?: string
      errorCode?: WorktreeRemoveErrorCode
      dirtySummary?: string
    }

export type RemoveManagedWorktreeDeps = {
  removeWorktree: (
    sessionId: string,
    worktreePath: string,
    force?: boolean,
  ) => Promise<{
    ok: boolean
    error?: string
    errorCode?: WorktreeRemoveErrorCode
    dirtySummary?: string
  }>
  deleteSession: (
    sessionId: string,
    opts?: { reason?: string; meta?: Record<string, unknown> },
  ) => void
}

/**
 * Shared product remove path for WorktreeDeleteDialog + context menu.
 * Non-force preflight may fail dirty; callers upgrade to force via dialog (progressive disclosure).
 */
export async function removeManagedWorktree(
  input: RemoveManagedWorktreeInput,
  deps?: Partial<RemoveManagedWorktreeDeps>,
): Promise<RemoveManagedWorktreeResult> {
  const remove =
    deps?.removeWorktree ??
    ((sessionId: string, worktreePath: string, force?: boolean) =>
      sessionService.removeWorktree(sessionId, worktreePath, force))
  const del =
    deps?.deleteSession ??
    ((sessionId: string, opts?: { reason?: string; meta?: Record<string, unknown> }) =>
      sessionService.deleteSession(sessionId, opts))

  const force = input.force === true
  const r = await remove(input.hostSessionId, input.worktreePath, force)
  if (!r.ok) {
    return {
      ok: false,
      dirty: isWorktreeDirtyError(r.error, r.errorCode),
      error: r.error,
      ...(r.errorCode ? { errorCode: r.errorCode } : {}),
      ...(r.dirtySummary ? { dirtySummary: r.dirtySummary } : {}),
    }
  }

  // Cascade via worktree:changed usually deletes bound *slot* sessions; defensive cleanup if event missed.
  // Never invent a host-session id — only the explicit slot binding is safe.
  if (input.slotSessionId) {
    try {
      del(input.slotSessionId, {
        reason: input.reason ?? 'worktree-remove',
        meta: {
          hostSessionId: input.hostSessionId,
          worktreePath: input.worktreePath,
          label: input.label,
          force,
        },
      })
    } catch {
      /* ignore */
    }
  }

  return { ok: true }
}
