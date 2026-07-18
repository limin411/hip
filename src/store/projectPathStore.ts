import { create } from 'zustand'
import { isDirectory } from '@/ipc/pathExists'
import { projectPathKey } from '@/lib/sessionProjectGroups'

const TTL_MS = 30_000

export type ProjectPathStatus = 'ok' | 'missing' | 'unknown'

interface PathEntry {
  /** true/false when known; null while unknown or check failed */
  exists: boolean | null
  checkedAt: number
  inFlight?: boolean
}

interface ProjectPathState {
  byKey: Record<string, PathEntry>
  /**
   * Lazily probe paths (deduped, TTL-cached). Safe to call often from render effects.
   */
  ensureChecked: (paths: Iterable<string | undefined | null>) => void
  /** Drop cache so the next ensureChecked re-probes (window focus / after rebind). */
  invalidate: (path?: string | null) => void
  /** Mark a path as present (e.g. right after user picked it). */
  markOk: (path: string) => void
  statusOf: (path: string | undefined | null) => ProjectPathStatus
  isMissing: (path: string | undefined | null) => boolean
}

export const useProjectPathStore = create<ProjectPathState>((set, get) => ({
  byKey: {},

  ensureChecked: (paths) => {
    const now = Date.now()
    const toCheck: string[] = []
    const st = get()
    for (const raw of paths) {
      const key = projectPathKey(raw)
      if (!key) continue
      const e = st.byKey[key]
      if (e?.inFlight) continue
      if (e && e.exists !== null && now - e.checkedAt < TTL_MS) continue
      toCheck.push(key)
    }
    if (toCheck.length === 0) return

    set((prev) => {
      const byKey = { ...prev.byKey }
      for (const k of toCheck) {
        byKey[k] = {
          exists: byKey[k]?.exists ?? null,
          checkedAt: byKey[k]?.checkedAt ?? 0,
          inFlight: true,
        }
      }
      return { byKey }
    })

    for (const key of toCheck) {
      void isDirectory(key).then((exists) => {
        set((prev) => ({
          byKey: {
            ...prev.byKey,
            [key]: {
              exists,
              checkedAt: Date.now(),
              inFlight: false,
            },
          },
        }))
      })
    }
  },

  invalidate: (path) => {
    if (path == null || path === '') {
      set({ byKey: {} })
      return
    }
    const key = projectPathKey(path)
    if (!key) return
    set((prev) => {
      const { [key]: _removed, ...rest } = prev.byKey
      return { byKey: rest }
    })
  },

  markOk: (path) => {
    const key = projectPathKey(path)
    if (!key) return
    set((prev) => ({
      byKey: {
        ...prev.byKey,
        [key]: { exists: true, checkedAt: Date.now(), inFlight: false },
      },
    }))
  },

  statusOf: (path) => {
    const key = projectPathKey(path)
    if (!key) return 'unknown'
    const e = get().byKey[key]
    if (!e || e.exists === null) return 'unknown'
    return e.exists ? 'ok' : 'missing'
  },

  isMissing: (path) => get().statusOf(path) === 'missing',
}))
