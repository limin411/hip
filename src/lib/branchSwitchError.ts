/**
 * Parse git's "branch already checked out elsewhere" failure into the owning
 * worktree path so the UI can point at the workspace holding the branch.
 *
 * git switch stderr (git ≥ 2.19), quoted and bare variants:
 *   fatal: 'feature-x' is already checked out at '/path/to/worktree'
 *   fatal: feature-x is already checked out at /path/to/worktree
 */
const CHECKED_OUT_QUOTED = /already checked out at '([^']+)'/
const CHECKED_OUT_BARE = /already checked out at ([^\s]+)/

export function parseCheckedOutPath(error: string | null | undefined): string | null {
  if (!error) return null
  const quoted = error.match(CHECKED_OUT_QUOTED)
  if (quoted?.[1]) return quoted[1]
  return CHECKED_OUT_BARE.exec(error)?.[1] ?? null
}
