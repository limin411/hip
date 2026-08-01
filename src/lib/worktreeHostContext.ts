/**
 * Resolve project host session for Studio worktree ops (list/create/remove/parallel).
 * Never pass an isolated slot session id as the git ops session without resolution.
 */
import type { ParallelRun } from '@/store/parallelStore'
import type { CatalogWorktree } from '@/store/worktreeStore'
import {
  collectNestedWorktreeSessionIds,
  extractParallelNestingHints,
  isManagedWorktreePath,
  nestableCatalogPaths,
  pathKey,
} from '@/lib/worktreeNesting'

export interface WorktreeHostContext {
  /** Session id to pass to git:worktree:list|create|remove and startParallelRun hostSessionId. */
  hostSessionId: string
  /** Absolute primary/main tree path when known. */
  primaryPath?: string
  /** Active session cwd (may be isolated). */
  activeCwd?: string
  /** Active managed worktree path if user is on an isolation; undefined if on primary. */
  activeWorktreePath?: string
  isOnIsolated: boolean
  /** Parallel run containing active session, if any. */
  runId?: string
  /** True when host could not be resolved — disable create/delete. */
  unresolved: boolean
  unresolvedReason?: 'no_active' | 'no_host' | 'no_cwd'
}

type ActiveSession = {
  id: string
  config: { cwd?: string; surface?: string }
} | null

type SessionLike = { id: string; title?: string; config: { cwd?: string } }

/**
 * activeWorktreePath tri-state for finalize:
 * - string → use as-is
 * - null → force none (host-of-run / not isolated)
 * - undefined → derive from cwd/catalog
 */
type ActiveWorktreeOverride = string | null | undefined

function findRunBySessionId(runs: ParallelRun[], sessionId: string): ParallelRun | undefined {
  return runs.find(
    (r) => r.hostSessionId === sessionId || r.slots.some((s) => s.sessionId === sessionId),
  )
}

function runsForHost(runs: ParallelRun[], sessionId: string): ParallelRun[] {
  return runs.filter((r) => r.hostSessionId === sessionId && r.slots.length > 0)
}

function primaryCatalogPath(catalog: CatalogWorktree[], repoKey?: string): string | undefined {
  const primary = catalog.find(
    (c) => c.isPrimary && (!repoKey || !c.repoKey || c.repoKey === repoKey),
  )
  return primary?.path
}

function catalogRowByPath(
  catalog: CatalogWorktree[],
  cwd: string | undefined,
): CatalogWorktree | undefined {
  if (!cwd) return undefined
  const key = pathKey(cwd)
  return catalog.find((c) => pathKey(c.path) === key)
}

function sessionWithCwd(
  sessions: SessionLike[],
  cwd: string | undefined,
): SessionLike | undefined {
  if (!cwd) return undefined
  const key = pathKey(cwd)
  return sessions.find((s) => s.config.cwd && pathKey(s.config.cwd) === key)
}

function deriveActiveWorktreePath(
  activeCwd: string | undefined,
  catalog: CatalogWorktree[],
  hostPrimaryPath?: string,
): string | undefined {
  if (!activeCwd) return undefined
  const key = pathKey(activeCwd)
  if (hostPrimaryPath && pathKey(hostPrimaryPath) === key) return undefined
  const row = catalogRowByPath(catalog, activeCwd)
  if (row && !row.isPrimary) return row.path
  if (isManagedWorktreePath(activeCwd)) return activeCwd
  return undefined
}

/**
 * Host is anchored when we can safely run git ops / fan-out:
 * host session still exists with a cwd, or we know the primary/main path.
 */
function hostIsAnchored(
  hostSessionId: string,
  primaryPath: string | undefined,
  sessions: SessionLike[],
): boolean {
  if (primaryPath) return true
  const host = sessions.find((s) => s.id === hostSessionId)
  return !!(host?.config.cwd)
}

function finalize(
  partial: {
    hostSessionId: string
    primaryPath?: string
    activeCwd?: string
    /** string = set; null = force none; undefined = derive */
    activeWorktreePath?: ActiveWorktreeOverride
    runId?: string
    unresolved: boolean
    unresolvedReason?: WorktreeHostContext['unresolvedReason']
  },
  catalog: CatalogWorktree[],
  sessions: SessionLike[],
): WorktreeHostContext {
  const hostSession = sessions.find((s) => s.id === partial.hostSessionId)
  let primaryPath = partial.primaryPath
  if (!primaryPath) {
    const hostPrimary = catalog.find(
      (c) =>
        c.isPrimary &&
        (c.hostSessionId === partial.hostSessionId ||
          !c.hostSessionId ||
          c.source === 'discovered'),
    )
    primaryPath = hostPrimary?.path ?? hostSession?.config.cwd ?? primaryCatalogPath(catalog)
  }

  let activeWorktreePath: string | undefined
  if (partial.activeWorktreePath === null) {
    // Force not-on-isolation (host-of-run)
    activeWorktreePath = undefined
  } else if (partial.activeWorktreePath !== undefined) {
    activeWorktreePath = partial.activeWorktreePath
  } else {
    activeWorktreePath = deriveActiveWorktreePath(partial.activeCwd, catalog, primaryPath)
  }
  const isOnIsolated = !!activeWorktreePath

  if (!primaryPath && !isOnIsolated && hostSession?.config.cwd) {
    primaryPath = hostSession.config.cwd
  }

  let unresolved = partial.unresolved
  let unresolvedReason = partial.unresolvedReason
  // Stale host id (deleted host session, empty catalog) must not look "resolved".
  if (!unresolved && partial.hostSessionId) {
    if (!hostIsAnchored(partial.hostSessionId, primaryPath, sessions)) {
      unresolved = true
      unresolvedReason = 'no_host'
    }
  }

  return {
    hostSessionId: partial.hostSessionId,
    primaryPath,
    activeCwd: partial.activeCwd,
    activeWorktreePath,
    isOnIsolated,
    runId: partial.runId,
    unresolved,
    unresolvedReason,
  }
}

/**
 * Resolve project host for Studio worktree ops.
 * Unit-test thoroughly — e2e remove already assumes ops session cwd is main repo.
 */
export function resolveWorktreeHostContext(input: {
  activeSession: ActiveSession
  sessions: SessionLike[]
  runs: ParallelRun[]
  catalog: CatalogWorktree[]
}): WorktreeHostContext {
  const { activeSession, sessions, runs, catalog } = input
  const activeCwd = activeSession?.config.cwd

  // 1. No active session
  if (!activeSession) {
    return {
      hostSessionId: '',
      unresolved: true,
      unresolvedReason: 'no_active',
      isOnIsolated: false,
    }
  }

  // 2. Parallel store: findRunBySessionId
  const run = findRunBySessionId(runs, activeSession.id)
  if (run?.hostSessionId) {
    const isSlot = run.slots.some((s) => s.sessionId === activeSession.id)
    const isHost = run.hostSessionId === activeSession.id
    if (isSlot || isHost) {
      const slot = run.slots.find((s) => s.sessionId === activeSession.id)
      return finalize(
        {
          hostSessionId: run.hostSessionId,
          activeCwd,
          // Host of run is never isolated; null forces skip of derive (Issue 4).
          // Slot uses slot path when known.
          activeWorktreePath: isSlot ? slot?.worktreePath || undefined : null,
          runId: run.id,
          unresolved: false,
        },
        catalog,
        sessions,
      )
    }
  }

  // 3. Active is host of some run
  const hosted = runsForHost(runs, activeSession.id)
  if (hosted.length > 0) {
    return finalize(
      {
        hostSessionId: activeSession.id,
        activeCwd,
        activeWorktreePath: null,
        runId: hosted[0]?.id,
        unresolved: false,
      },
      catalog,
      sessions,
    )
  }

  // 4. Catalog / path: cwd matches a non-primary catalog path
  const cwdRow = catalogRowByPath(catalog, activeCwd)
  if (cwdRow && !cwdRow.isPrimary) {
    // Prefer an explicit host binding, but never treat the isolated session itself as host
    // (list:result used to stamp nested session ids and sticky-steal the sidebar tree).
    if (cwdRow.hostSessionId && cwdRow.hostSessionId !== activeSession.id) {
      return finalize(
        {
          hostSessionId: cwdRow.hostSessionId,
          activeCwd,
          activeWorktreePath: cwdRow.path,
          unresolved: false,
        },
        catalog,
        sessions,
      )
    }
    const primaryPath = primaryCatalogPath(catalog, cwdRow.repoKey)
    if (primaryPath) {
      const primarySession = sessionWithCwd(sessions, primaryPath)
      if (primarySession && primarySession.id !== activeSession.id) {
        return finalize(
          {
            hostSessionId: primarySession.id,
            primaryPath,
            activeCwd,
            activeWorktreePath: cwdRow.path,
            unresolved: false,
          },
          catalog,
          sessions,
        )
      }
    }
  }

  // 5. Managed path without catalog
  if (isManagedWorktreePath(activeCwd)) {
    for (const r of runs) {
      const slot = r.slots.find(
        (s) =>
          s.worktreePath &&
          activeCwd &&
          pathKey(s.worktreePath) === pathKey(activeCwd),
      )
      if (slot && r.hostSessionId) {
        return finalize(
          {
            hostSessionId: r.hostSessionId,
            activeCwd,
            activeWorktreePath: slot.worktreePath || activeCwd,
            runId: r.id,
            unresolved: false,
          },
          catalog,
          sessions,
        )
      }
    }
    return {
      hostSessionId: '',
      activeCwd,
      activeWorktreePath: activeCwd,
      isOnIsolated: true,
      unresolved: true,
      unresolvedReason: 'no_host',
    }
  }

  // 6. Default: treat active as host if it has cwd and is not nested
  if (!activeCwd) {
    return {
      hostSessionId: '',
      unresolved: true,
      unresolvedReason: 'no_cwd',
      isOnIsolated: false,
    }
  }

  const nestHints = extractParallelNestingHints(runs)
  const nested = collectNestedWorktreeSessionIds({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      config: s.config,
    })),
    slotSessionIds: nestHints.slotSessionIds,
    worktreePaths: [...nestHints.worktreePaths, ...nestableCatalogPaths(catalog)],
  })

  if (!nested.has(activeSession.id)) {
    return finalize(
      {
        hostSessionId: activeSession.id,
        activeCwd,
        activeWorktreePath: null,
        unresolved: false,
      },
      catalog,
      sessions,
    )
  }

  // 7. Still unknown
  const activeWorktreePath = deriveActiveWorktreePath(activeCwd, catalog)
  return {
    hostSessionId: '',
    activeCwd,
    activeWorktreePath,
    isOnIsolated: !!activeWorktreePath,
    unresolved: true,
    unresolvedReason: 'no_host',
  }
}

/**
 * Host id to stamp on catalog rows after `git:worktree:list:result`.
 *
 * Selecting a nested worktree session still requests a list (sessionService.selectSession).
 * Tagging that nested id as catalog host steals rows from the project host — sidebar
 * worktree tree under the host collapses and nested sessions have nowhere to render.
 */
export function resolveWorktreeListCatalogHost(input: {
  /** sessionId from the list result (requester). */
  sessionId: string
  /** Snapshot paths from git (used when catalog host binding is still empty). */
  worktrees: Array<{ path: string; isPrimary?: boolean }>
  activeSession: ActiveSession
  sessions: SessionLike[]
  runs: ParallelRun[]
  catalog: CatalogWorktree[]
}): string {
  const ctx = resolveWorktreeHostContext({
    activeSession: input.activeSession,
    sessions: input.sessions,
    runs: input.runs,
    catalog: input.catalog,
  })

  const primaryPath =
    input.worktrees.find((w) => w.isPrimary)?.path ??
    input.catalog.find((c) => c.isPrimary)?.path
  const requesterCwd = input.activeSession?.config.cwd
  const requesterIsIsolated =
    !!requesterCwd &&
    (isManagedWorktreePath(requesterCwd) ||
      (!!primaryPath && pathKey(requesterCwd) !== pathKey(primaryPath)))

  // Trust context host unless it collapsed to the nested requester itself.
  if (ctx.hostSessionId && !(requesterIsIsolated && ctx.hostSessionId === input.sessionId)) {
    return ctx.hostSessionId
  }

  if (primaryPath) {
    const primaryKey = pathKey(primaryPath)
    const anchored = input.sessions.find(
      (s) =>
        s.id !== input.sessionId && s.config.cwd && pathKey(s.config.cwd) === primaryKey,
    )
    if (anchored) return anchored.id
  }

  // Keep a prior project-host binding rather than rebinding to the nested requester.
  const prevHost = input.catalog.find(
    (r) => r.hostSessionId && r.hostSessionId !== input.sessionId,
  )?.hostSessionId
  if (prevHost) return prevHost

  // Isolated requester with no recoverable host: leave prior stamps alone by returning
  // sessionId only when it is not isolated (host path).
  if (requesterIsIsolated) {
    // Prefer any non-isolated code session id already present as a catalog host stamp.
    const stamped = input.catalog.find((r) => {
      if (!r.hostSessionId || r.hostSessionId === input.sessionId) return false
      const host = input.sessions.find((s) => s.id === r.hostSessionId)
      return !!host && !isManagedWorktreePath(host.config.cwd)
    })?.hostSessionId
    if (stamped) return stamped
  }

  return input.sessionId
}
