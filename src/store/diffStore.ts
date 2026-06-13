import { create } from 'zustand'
import type { DiffFile, DiffState, DiffBase, DiffSummary } from '@hip/protocol'

export interface SessionDiff {
  status: 'idle' | 'loading' | 'ready'
  state?: DiffState
  base: DiffBase
  hasSessionStart: boolean
  files: DiffFile[]
  summary?: DiffSummary
  error?: string
  initPending: boolean
  expanded: Record<string, DiffFile>
}

export const EMPTY_DIFF: SessionDiff = { status: 'idle', base: 'session-start', hasSessionStart: false, files: [], initPending: false, expanded: {} }

interface SetResultArg { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; base: DiffBase; hasSessionStart: boolean; error?: string }

interface DiffStore {
  bySession: Record<string, SessionDiff>
  setLoading: (sessionId: string) => void
  setResult: (sessionId: string, r: SetResultArg) => void
  setSummary: (sessionId: string, summary: DiffSummary, base: DiffBase, hasSessionStart: boolean) => void
  setInitPending: (sessionId: string, pending: boolean) => void
  setBase: (sessionId: string, base: DiffBase) => void
  setFileExpanded: (sessionId: string, path: string, file: DiffFile) => void
  collapseFile: (sessionId: string, path: string) => void
  clearSession: (sessionId: string) => void
  resetTransient: () => void
}

function patch(by: Record<string, SessionDiff>, id: string, fn: (s: SessionDiff) => SessionDiff): Record<string, SessionDiff> {
  return { ...by, [id]: fn(by[id] ?? EMPTY_DIFF) }
}

export const useDiffStore = create<DiffStore>((set) => ({
  bySession: {},
  setLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'loading' })) })),
  setResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({
    ...s, status: 'ready', state: r.state, files: r.files ?? [], summary: r.summary, base: r.base, hasSessionStart: r.hasSessionStart, error: r.error, expanded: {},
  })) })),
  setSummary: (id, summary, base, hasSessionStart) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, summary, base, hasSessionStart })) })),
  setInitPending: (id, pending) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, initPending: pending })) })),
  setBase: (id, base) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, base })) })),
  setFileExpanded: (id, p, file) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, expanded: { ...s.expanded, [p]: file } })) })),
  collapseFile: (id, p) => set((st) => ({ bySession: patch(st.bySession, id, (s) => { const e = { ...s.expanded }; delete e[p]; return { ...s, expanded: e } }) })),
  clearSession: (id) => set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_DIFF } })),
  resetTransient: () => set((st) => ({
    bySession: Object.fromEntries(Object.entries(st.bySession).map(([id, s]) => [id, { ...s, status: s.status === 'loading' ? 'idle' : s.status, initPending: false }])),
  })),
}))
