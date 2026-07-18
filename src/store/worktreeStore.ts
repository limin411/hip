import { create } from 'zustand'
import type { WorktreeInfo, WorktreeRecord } from '@hip/protocol'

/** Catalog row for Studio sidebar (managed + primary). */
export interface CatalogWorktree {
  id: string
  path: string
  branch: string
  head: string
  repoKey: string
  isPrimary: boolean
  managed: boolean
  ephemeral?: boolean
  source?: string
  label?: string
  hostSessionId?: string
}

interface WorktreeCatalogState {
  /** Keyed by id */
  byId: Record<string, CatalogWorktree>
  /** Last repoKey seen (for filtering) */
  lastRepoKey?: string
  /** Path to expand/scroll after create */
  pendingRevealPath?: string
  /**
   * Apply an authoritative git worktree list snapshot (delta upsert + prune).
   * Rows for repoKeys covered by the list but absent from it are removed.
   */
  upsertFromList: (worktrees: WorktreeInfo[], hostSessionId?: string) => void
  applyChanged: (record: WorktreeRecord, kind: string, reveal?: boolean) => void
  removeByPath: (path: string) => void
  clear: () => void
  setPendingReveal: (path?: string) => void
  /** Managed non-ephemeral + primary for a host session (or all if no host filter). */
  catalogForHost: (hostSessionId?: string) => CatalogWorktree[]
}

function pathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function fromInfo(w: WorktreeInfo, hostSessionId?: string): CatalogWorktree {
  return {
    id: w.id || pathKey(w.path),
    path: w.path,
    branch: w.branch,
    head: w.head,
    repoKey: w.repoKey || '',
    isPrimary: w.isPrimary === true,
    managed: w.managed === true,
    ephemeral: w.ephemeral,
    source: w.source,
    label: w.label || w.branch || w.path.split(/[/\\]/).filter(Boolean).pop(),
    hostSessionId,
  }
}

function fromRecord(r: WorktreeRecord): CatalogWorktree {
  return {
    id: r.id,
    path: r.path,
    branch: r.branch,
    head: r.head,
    repoKey: r.repoKey,
    isPrimary: r.isPrimary,
    managed: r.managed,
    ephemeral: r.ephemeral,
    source: r.source,
    label: r.label || r.branch,
    hostSessionId: r.hostSessionId,
  }
}

/** Hide disposable bg isolates (KD14). */
export function isCatalogVisible(w: CatalogWorktree): boolean {
  if (w.ephemeral) return false
  if (w.branch && /^hip-bg-/i.test(w.branch)) return false
  return w.managed || w.isPrimary
}

export const useWorktreeStore = create<WorktreeCatalogState>()((set, get) => ({
  byId: {},

  upsertFromList: (worktrees, hostSessionId) => {
    set((st) => {
      const next = { ...st.byId }
      let lastRepoKey = st.lastRepoKey
      const presentIds = new Set<string>()
      const presentPaths = new Set<string>()
      const repoKeys = new Set<string>()

      for (const w of worktrees) {
        const row = fromInfo(w, hostSessionId)
        presentIds.add(row.id)
        presentPaths.add(pathKey(row.path))
        if (row.repoKey) {
          repoKeys.add(row.repoKey)
          lastRepoKey = row.repoKey
        }
        // Invisible rows (ephemeral / bg) must not linger if they were ever catalogued.
        if (!isCatalogVisible(row) && !row.isPrimary) {
          delete next[row.id]
          continue
        }
        const prev = next[row.id]
        next[row.id] = {
          ...row,
          // List payloads omit host; keep association when re-hydrating.
          hostSessionId: row.hostSessionId ?? prev?.hostSessionId,
        }
      }

      // Snapshot prune: drop non-primary rows for covered repos that are gone from git.
      for (const [id, row] of Object.entries(next)) {
        if (row.isPrimary) continue
        if (row.repoKey && !repoKeys.has(row.repoKey)) continue
        // Rows without repoKey only prune when the snapshot includes a path match set
        // and we can prove the path is missing — skip unkeyed orphans from other sources.
        if (!row.repoKey) continue
        if (presentIds.has(id) || presentPaths.has(pathKey(row.path))) continue
        delete next[id]
      }

      return { byId: next, lastRepoKey }
    })
  },

  applyChanged: (record, kind, reveal) => {
    set((st) => {
      const next = { ...st.byId }
      if (kind === 'removed') {
        delete next[record.id]
        for (const [id, row] of Object.entries(next)) {
          if (pathKey(row.path) === pathKey(record.path)) delete next[id]
        }
        return {
          byId: next,
          pendingRevealPath: reveal ? undefined : st.pendingRevealPath,
        }
      }
      const row = fromRecord(record)
      if (!isCatalogVisible(row) && !row.isPrimary) {
        delete next[row.id]
        return { byId: next }
      }
      next[row.id] = row
      return {
        byId: next,
        lastRepoKey: row.repoKey || st.lastRepoKey,
        pendingRevealPath: reveal ? row.path : st.pendingRevealPath,
      }
    })
  },

  removeByPath: (p) => {
    const key = pathKey(p)
    set((st) => {
      const next = { ...st.byId }
      for (const [id, row] of Object.entries(next)) {
        if (pathKey(row.path) === key) delete next[id]
      }
      return { byId: next }
    })
  },

  clear: () => set({ byId: {}, lastRepoKey: undefined, pendingRevealPath: undefined }),

  setPendingReveal: (path) => set({ pendingRevealPath: path }),

  catalogForHost: (hostSessionId) => {
    const rows = Object.values(get().byId).filter(isCatalogVisible)
    if (!hostSessionId) return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.path.localeCompare(b.path))
    // Host filter: primary always + rows with matching hostSessionId or no host (discovered)
    return rows
      .filter(
        (r) =>
          r.isPrimary ||
          r.hostSessionId === hostSessionId ||
          !r.hostSessionId ||
          r.source === 'discovered' ||
          r.source === 'agent_tool' ||
          r.source === 'protocol' ||
          r.source === 'parallel',
      )
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.path.localeCompare(b.path))
  },
}))

/**
 * Dedup paths already shown as parallel slots so catalog does not double-render.
 */
export function catalogMinusParallelPaths(
  catalog: CatalogWorktree[],
  parallelPaths: Set<string>,
): CatalogWorktree[] {
  const keys = new Set([...parallelPaths].map(pathKey))
  return catalog.filter((c) => !keys.has(pathKey(c.path)))
}
