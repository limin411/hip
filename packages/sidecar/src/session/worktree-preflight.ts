/**
 * Worktree delete preflight (spec H4 / Orca worktree-delete-preflight).
 * Check dirty status before tearing down PTYs or removing the worktree.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export class WorktreeDirtyError extends Error {
  readonly code = 'WORKTREE_DIRTY'
  constructor(public readonly worktreePath: string, public readonly statusOutput: string) {
    super(`Worktree is dirty (uncommitted changes): ${worktreePath}`)
    this.name = 'WorktreeDirtyError'
  }
}

/**
 * Throws WorktreeDirtyError when porcelain status is non-empty and force is false.
 * force=true skips the check (caller may still force-remove).
 */
export async function assertWorktreeCleanForRemoval(
  worktreePath: string,
  force = false,
): Promise<void> {
  if (force) return
  try {
    const { stdout } = await execFileP(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: worktreePath, maxBuffer: 2 * 1024 * 1024 },
    )
    const out = (stdout ?? '').trim()
    if (out.length > 0) {
      throw new WorktreeDirtyError(worktreePath, out)
    }
  } catch (err) {
    if (err instanceof WorktreeDirtyError) throw err
    // Missing worktree / not a git dir: let remove path handle orphan cleanup.
    const msg = err instanceof Error ? err.message : String(err)
    if (/not a git repository|is not a working tree|ENOENT/i.test(msg)) return
    throw err
  }
}
