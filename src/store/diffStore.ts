import { create } from 'zustand'
import type { DiffFile, DiffState, DiffBase, DiffSummary, Checkpoint, CommitLogEntry } from '@hip/protocol'

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
  collapsed: Record<string, boolean>
  // --- checkpoint / git-panel additions (A1) ---
  isGitRepo: boolean
  currentBranch: string | null
  checkpoints: Checkpoint[]
  activeCheckpointId: string | null
  // per (checkpointId|mode) cached diff result; key = `${checkpointId}|${mode}`
  checkpointDiff: Record<string, { status: 'loading' | 'ready'; state?: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }>
  commitLog: { status: 'idle' | 'loading' | 'ready'; state?: DiffState; commits: CommitLogEntry[]; error?: string }
}

export const EMPTY_DIFF: SessionDiff = {
  status: 'idle', base: 'session-start', hasSessionStart: false, files: [], initPending: false, expanded: {}, collapsed: {},
  isGitRepo: false, currentBranch: null, checkpoints: [], activeCheckpointId: null, checkpointDiff: {}, commitLog: { status: 'idle', commits: [] },
}

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
  toggleCollapsed: (sessionId: string, path: string) => void
  clearSession: (sessionId: string) => void
  setCheckpoints: (sessionId: string, checkpoints: Checkpoint[], isGitRepo: boolean, currentBranch: string | null) => void
  addCheckpoint: (sessionId: string, checkpoint: Checkpoint) => void
  setActiveCheckpoint: (sessionId: string, checkpointId: string | null) => void
  setCheckpointDiffLoading: (sessionId: string, key: string) => void
  setCheckpointDiffResult: (sessionId: string, key: string, r: { state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }) => void
  setCommitLogLoading: (sessionId: string) => void
  setCommitLogResult: (sessionId: string, r: { state: DiffState; commits: CommitLogEntry[]; error?: string }) => void
  resetTransient: () => void
}

function patch(by: Record<string, SessionDiff>, id: string, fn: (s: SessionDiff) => SessionDiff): Record<string, SessionDiff> {
  return { ...by, [id]: fn(by[id] ?? EMPTY_DIFF) }
}

export const useDiffStore = create<DiffStore>((set) => ({
  bySession: {},
  setLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, status: 'loading' })) })),
  setResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({
    ...s, status: 'ready', state: r.state, files: r.files ?? [], summary: r.summary, base: r.base, hasSessionStart: r.hasSessionStart, error: r.error, expanded: {}, collapsed: {},
  })) })),
  setSummary: (id, summary, base, hasSessionStart) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, summary, base, hasSessionStart })) })),
  setInitPending: (id, pending) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, initPending: pending })) })),
  setBase: (id, base) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, base })) })),
  setFileExpanded: (id, p, file) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, expanded: { ...s.expanded, [p]: file } })) })),
  collapseFile: (id, p) => set((st) => ({ bySession: patch(st.bySession, id, (s) => { const e = { ...s.expanded }; delete e[p]; return { ...s, expanded: e } }) })),
  toggleCollapsed: (id, p) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, collapsed: { ...s.collapsed, [p]: !s.collapsed[p] } })) })),
  clearSession: (id) => set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_DIFF } })),
  setCheckpoints: (id, checkpoints, isGitRepo, currentBranch) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, checkpoints, isGitRepo, currentBranch })) })),
  addCheckpoint: (id, checkpoint) => set((st) => ({ bySession: patch(st.bySession, id, (s) => (s.checkpoints.some((c) => c.id === checkpoint.id) ? s : { ...s, checkpoints: [checkpoint, ...s.checkpoints] })) })),
  setActiveCheckpoint: (id, checkpointId) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, activeCheckpointId: checkpointId })) })),
  setCheckpointDiffLoading: (id, key) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, checkpointDiff: { ...s.checkpointDiff, [key]: { status: 'loading' } } })) })),
  setCheckpointDiffResult: (id, key, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, checkpointDiff: { ...s.checkpointDiff, [key]: { status: 'ready', state: r.state, files: r.files, summary: r.summary, error: r.error } } })) })),
  setCommitLogLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitLog: { ...s.commitLog, status: 'loading' } })) })),
  setCommitLogResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitLog: { status: 'ready', state: r.state, commits: r.commits, error: r.error } })) })),
  resetTransient: () => set((st) => ({
    bySession: Object.fromEntries(Object.entries(st.bySession).map(([id, s]) => [id, { ...s, status: s.status === 'loading' ? 'idle' : s.status, initPending: false }])),
  })),
}))
