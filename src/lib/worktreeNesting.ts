/**
 * Worktree / parallel-slot sessions are nested under a host project — never top-level
 * first-class rows in the sidebar or history list.
 */

export function pathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Host-fanout slot titles: `P1/2 · abc123`. */
const SLOT_TITLE_RE = /^P\d+\/\d+ · /

/**
 * Paths under hip's managed worktree roots (default ~/.hip/worktrees, eval runs).
 * HIP_WORKTREES_DIR can relocate the root; callers should also pass explicit known paths.
 */
export function isManagedWorktreePath(cwd: string | undefined | null): boolean {
  if (!cwd) return false
  const p = pathKey(cwd)
  return /\/\.hip\/worktrees(\/|$)/i.test(p) || /\/\.hip\/eval-runs\/worktrees(\/|$)/i.test(p)
}

export function isParallelSlotTitle(title: string | undefined | null): boolean {
  return !!title && SLOT_TITLE_RE.test(title)
}

export interface NestedSessionInputs {
  sessions: Array<{ id: string; title: string; config: { cwd?: string } }>
  /** sessionIds from parallel slots (host fan-out). */
  slotSessionIds?: Iterable<string>
  /** Known worktree absolute paths (catalog + parallel slots). */
  worktreePaths?: Iterable<string>
}

/**
 * Session ids that must not appear as top-level conversations.
 * Union of: explicit slot ids, cwd on a known worktree path, managed-root cwd, slot title pattern.
 */
export function collectNestedWorktreeSessionIds(input: NestedSessionInputs): Set<string> {
  const nested = new Set<string>()
  for (const id of input.slotSessionIds ?? []) {
    if (id) nested.add(id)
  }

  const wtPaths = new Set<string>()
  for (const p of input.worktreePaths ?? []) {
    if (p) wtPaths.add(pathKey(p))
  }

  for (const s of input.sessions) {
    if (nested.has(s.id)) continue
    if (isParallelSlotTitle(s.title)) {
      nested.add(s.id)
      continue
    }
    const cwd = s.config.cwd
    if (!cwd) continue
    const key = pathKey(cwd)
    if (wtPaths.has(key) || isManagedWorktreePath(cwd)) {
      nested.add(s.id)
    }
  }
  return nested
}

/** Collect slot session ids + worktree paths from parallel runs. */
export function extractParallelNestingHints(
  runs: Array<{
    slots: Array<{ sessionId?: string; worktreePath?: string }>
  }>,
): { slotSessionIds: string[]; worktreePaths: string[] } {
  const slotSessionIds: string[] = []
  const worktreePaths: string[] = []
  for (const run of runs) {
    for (const slot of run.slots) {
      if (slot.sessionId) slotSessionIds.push(slot.sessionId)
      if (slot.worktreePath) worktreePaths.push(slot.worktreePath)
    }
  }
  return { slotSessionIds, worktreePaths }
}
