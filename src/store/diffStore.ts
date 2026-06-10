import { create } from 'zustand'
import type { DiffFile, DiffState } from '@hip/protocol'

export interface SessionDiff {
  status: 'idle' | 'loading' | 'ready'
  state?: DiffState
  files: DiffFile[]
  totalFiles: number
  error?: string
  initPending: boolean
}

export const EMPTY_DIFF: SessionDiff = { status: 'idle', files: [], totalFiles: 0, initPending: false }

interface DiffStore {
  bySession: Record<string, SessionDiff>
  setLoading: (sessionId: string) => void
  setResult: (sessionId: string, r: { state: DiffState; files?: DiffFile[]; totalFiles?: number; error?: string }) => void
  setInitPending: (sessionId: string, pending: boolean) => void
  clearSession: (sessionId: string) => void
  /** Reconnect reconciliation: a (re)connect means any in-flight request is lost — unwedge. */
  resetTransient: () => void
}

function patch(bySession: Record<string, SessionDiff>, id: string, fn: (s: SessionDiff) => SessionDiff): Record<string, SessionDiff> {
  return { ...bySession, [id]: fn(bySession[id] ?? EMPTY_DIFF) }
}

export const useDiffStore = create<DiffStore>((set) => ({
  bySession: {},
  setLoading: (id) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'loading' })) })),
  setResult: (id, r) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'ready', state: r.state, files: r.files ?? [], totalFiles: r.totalFiles ?? r.files?.length ?? 0, error: r.error })) })),
  setInitPending: (id, pending) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, initPending: pending })) })),
  clearSession: (id) =>
    set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_DIFF } })),
  resetTransient: () =>
    set((st) => ({
      bySession: Object.fromEntries(
        Object.entries(st.bySession).map(([id, s]) => [
          id,
          { ...s, status: s.status === 'loading' ? 'idle' : s.status, initPending: false },
        ]),
      ),
    })),
}))
