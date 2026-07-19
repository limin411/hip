/**
 * Pure helpers for parallel worktree studio (spec H1–H5).
 */

export type ParallelSlotStatus = 'running' | 'awaiting_user' | 'done' | 'failed' | 'stopped'

export interface ParallelSlotPlan {
  index: number
  branch: string
  /**
   * Branch segment only (usually equals `branch`), **not** the full create pathKey.
   * Product create composes `{fullRunId}/{branch}` in `startParallelRun` (D26).
   * Do not pass this field alone as `git:worktree:create.pathKey`.
   */
  pathKey: string
  label: string
}

export interface ParallelFanoutPlan {
  n: number
  baseBranch: string
  slots: ParallelSlotPlan[]
  prompt: string
}

/**
 * Build N slot plans without touching git (unit-testable).
 * @param opts.runId Short id used in branch names (`hip-p-{runId}-{i}`). This is
 *   typically runShort (6 chars), not the full run id used in on-disk pathKey.
 */
export function planParallelFanout(opts: {
  n: number
  prompt: string
  baseBranch?: string
  runId?: string
}): ParallelFanoutPlan {
  // Keep bounds aligned with src/lib/parallelCount.ts (PARALLEL_COUNT_MIN/MAX).
  const raw = Number.isFinite(opts.n) ? Math.floor(opts.n) : 2
  const n = Math.min(4, Math.max(1, raw))
  const runId = opts.runId ?? `prun-${Date.now().toString(36)}`
  const baseBranch = opts.baseBranch ?? 'HEAD'
  const slots: ParallelSlotPlan[] = []
  // D26: match agent parallel_worktrees — hip-p-{runShort}-{1..n}.
  // pathKey here is the branch segment only; startParallelRun composes fullRunId/branch.
  for (let i = 0; i < n; i++) {
    const slotNum = i + 1
    const branch = `hip-p-${runId}-${slotNum}`
    slots.push({
      index: i,
      branch,
      pathKey: branch,
      label: `slot-${slotNum}`,
    })
  }
  return { n, baseBranch, slots, prompt: opts.prompt }
}

/** Primary tree must not receive agent writes from parallel slots. */
export function assertPrimaryNotInSlotPaths(
  primaryPath: string,
  slotPaths: string[],
): { ok: true } | { ok: false; conflict: string } {
  const primary = primaryPath.replace(/\/$/, '')
  for (const p of slotPaths) {
    const norm = p.replace(/\/$/, '')
    if (norm === primary) return { ok: false, conflict: p }
  }
  return { ok: true }
}
