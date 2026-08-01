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
 * Roots are always named `worktrees` — default ~/.hip/worktrees, and relocations via
 * HIP_DATA_DIR (<dir>/worktrees) or HIP_WORKTREES_DIR — so match any `worktrees`
 * path segment regardless of where the root lives.
 */
export function isManagedWorktreePath(cwd: string | undefined | null): boolean {
  if (!cwd) return false
  const p = pathKey(cwd)
  return /(^|\/)worktrees(\/|$)/i.test(p)
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
 *
 * Only nest when the sidebar/history UI can still reach the session under a host:
 * - explicit parallel `slotSessionIds` (rendered as WorktreeSlotRow)
 * - cwd on a known *non-primary* worktree path from catalog/parallel (`worktreePaths`)
 *
 * Do NOT nest solely because cwd is under `~/.hip/worktrees` or the title looks like
 * `P1/2 · …`. Those orphans have no host tree row and would vanish from the UI
 * ("missing records").
 *
 * Callers must NOT pass primary (main-repo) catalog paths into `worktreePaths`.
 * Selecting a Code session hydrates `git:worktree:list`, which always includes
 * the primary worktree whose path equals the host session cwd — matching that
 * path would hide every host project from the sidebar.
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
  if (wtPaths.size === 0) return nested

  for (const s of input.sessions) {
    if (nested.has(s.id)) continue
    const cwd = s.config.cwd
    if (!cwd) continue
    if (wtPaths.has(pathKey(cwd))) nested.add(s.id)
  }
  return nested
}

/**
 * Paths safe to use for nesting detection: non-primary catalog rows only.
 * Primary = main repo checkout; host Code sessions live there and must stay top-level.
 */
export function nestableCatalogPaths(
  catalog: Iterable<{ path: string; isPrimary?: boolean }>,
): string[] {
  const out: string[] = []
  for (const row of catalog) {
    if (row.isPrimary) continue
    if (row.path) out.push(row.path)
  }
  return out
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

/**
 * Decide which sessions may be hard-deleted when a worktree is removed.
 *
 * Safety rules (tighten vs blind cwd match):
 * - Prefer explicit parallel-slot bindings (sessionId on matching slot).
 * - Optionally include cwd===removedPath only when the session looks like a slot
 *   (managed worktree path or P#/# · title).
 * - Never cascade-delete a parallel hostSessionId (project conversation).
 */
export function collectWorktreeCascadeDeleteIds(input: {
  removedPath?: string | null
  removedWorktreeId?: string | null
  runs: Array<{
    hostSessionId?: string
    slots: Array<{
      sessionId?: string
      worktreeId?: string
      worktreePath?: string
    }>
  }>
  sessions: Array<{ id: string; title: string; config: { cwd?: string } }>
}): {
  toDelete: string[]
  skipped: Array<{ id: string; why: string }>
  candidatesFromSlots: string[]
  candidatesFromCwd: string[]
} {
  const removedKey = input.removedPath ? pathKey(input.removedPath) : ''
  const removedId = input.removedWorktreeId || ''
  const hostIds = new Set<string>()
  for (const run of input.runs) {
    if (run.hostSessionId) hostIds.add(run.hostSessionId)
  }

  const fromSlots = new Set<string>()
  for (const run of input.runs) {
    for (const slot of run.slots) {
      if (!slot.sessionId) continue
      let match = false
      if (removedId && slot.worktreeId && slot.worktreeId === removedId) match = true
      if (removedKey && slot.worktreePath && pathKey(slot.worktreePath) === removedKey) match = true
      if (match) fromSlots.add(slot.sessionId)
    }
  }

  const fromCwd = new Set<string>()
  const skipped: Array<{ id: string; why: string }> = []
  if (removedKey) {
    for (const s of input.sessions) {
      const cwd = s.config.cwd
      if (!cwd) continue
      if (pathKey(cwd) !== removedKey) continue
      if (hostIds.has(s.id)) {
        skipped.push({ id: s.id, why: 'host-session-protected' })
        continue
      }
      if (fromSlots.has(s.id)) continue
      // Only treat as cascade-eligible when clearly a worktree/slot session.
      if (isManagedWorktreePath(cwd) || isParallelSlotTitle(s.title)) {
        fromCwd.add(s.id)
      } else {
        skipped.push({ id: s.id, why: 'cwd-match-but-not-slot-like' })
      }
    }
  }

  const toDelete = new Set<string>()
  for (const id of fromSlots) {
    if (hostIds.has(id)) {
      skipped.push({ id, why: 'slot-id-is-also-host-protected' })
      continue
    }
    toDelete.add(id)
  }
  for (const id of fromCwd) toDelete.add(id)

  return {
    toDelete: [...toDelete],
    skipped,
    candidatesFromSlots: [...fromSlots],
    candidatesFromCwd: [...fromCwd],
  }
}
