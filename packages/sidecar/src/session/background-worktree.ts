/**
 * Optional git worktree isolation for background subagents.
 * Keeps experimental edits out of the main working tree until the user merges.
 */
import { join } from 'node:path'
import { createWorktree, removeWorktree, gitCreateBranch, sanitizeRefComponent } from './workspace-git.js'
import { getWorktreesDir } from './worktree-config.js'

export interface BackgroundWorktreeHandle {
  /** Root the subagent should use (worktree path or original cwd). */
  root: string
  /** True when a disposable worktree was created. */
  isolated: boolean
  /** Best-effort cleanup (remove worktree). Safe to call multiple times. */
  cleanup(): Promise<void>
}

/**
 * Try to isolate a background task in a linked git worktree.
 * Falls back to `cwd` when not a git repo, worktree creation fails, or isolation is disabled.
 *
 * Disable with env `HIP_BG_WORKTREE=0`.
 */
export async function acquireBackgroundWorktree(
  cwd: string,
  sessionId: string,
  taskId: string,
): Promise<BackgroundWorktreeHandle> {
  const noop: BackgroundWorktreeHandle = {
    root: cwd,
    isolated: false,
    cleanup: async () => {},
  }

  if (process.env.HIP_BG_WORKTREE === '0') return noop
  if (!cwd) return noop

  const branch = `hip-bg-${sanitizeRefComponent(sessionId).slice(0, 12)}-${sanitizeRefComponent(taskId).slice(0, 16)}`
  const wtPath = join(getWorktreesDir(), sanitizeRefComponent(sessionId), sanitizeRefComponent(taskId))

  // Branch from current HEAD (no checkout of main tree).
  const createdBranch = await gitCreateBranch(cwd, branch)
  if (!createdBranch.ok) {
    // Branch may already exist from a prior attempt — try worktree add anyway.
    if (!/already exists/i.test(createdBranch.error ?? '')) return noop
  }

  const wt = await createWorktree(cwd, branch, wtPath)
  if (!wt.ok || !wt.path) return noop

  let cleaned = false
  return {
    root: wt.path,
    isolated: true,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await removeWorktree(cwd, wt.path!).catch(() => {})
    },
  }
}
