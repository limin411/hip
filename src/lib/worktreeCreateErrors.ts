/**
 * Detect non-git / not-a-repo create failures (D24).
 * Wire list result has no ok/error today — empty catalog ≠ non-git;
 * only create (or other op) errors set the flag.
 */
export function isNonGitWorktreeError(error?: string | null): boolean {
  if (!error) return false
  return /not_a_repo|not a git repository|is not a git|not a working tree/i.test(error)
}
