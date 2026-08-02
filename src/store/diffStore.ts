import { create } from 'zustand'
import type { DiffFile, DiffState, DiffBase, DiffSummary, CommitLogEntry, Branch } from '@hip/protocol'

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
  // --- git-panel additions (A1) ---
  isGitRepo: boolean
  currentBranch: string | null
  branches: Branch[]
  // Transient write-op failure (A2) — surfaced + cleared by the BranchSwitcher
  // confirm modal so a FAILED switch resets the spinner instead of bricking the modal.
  switchError: string | null
  commitLog: { status: 'idle' | 'loading' | 'ready'; state?: DiffState; commits: CommitLogEntry[]; error?: string }
  /** Commit whose diff is currently shown instead of the uncommitted list (null = uncommitted). */
  viewingCommitSha: string | null
  commitDiff: { status: 'idle' | 'loading' | 'ready'; state?: DiffState; files: DiffFile[]; error?: string }
  /** Per-path discard in-flight flags (git:discard sent, result pending). */
  discardPending: Record<string, boolean>
}

export const EMPTY_DIFF: SessionDiff = {
  status: 'idle', base: 'session-start', hasSessionStart: false, files: [], initPending: false, expanded: {}, collapsed: {},
  isGitRepo: false, currentBranch: null, branches: [], switchError: null, commitLog: { status: 'idle', commits: [] },
  viewingCommitSha: null, commitDiff: { status: 'idle', files: [] }, discardPending: {},
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
  setCollapsed: (sessionId: string, collapsed: Record<string, boolean>) => void
  clearSession: (sessionId: string) => void
  setGitState: (sessionId: string, isGitRepo: boolean, currentBranch: string | null) => void
  setBranches: (sessionId: string, branches: Branch[], currentBranch: string | null) => void
  setSwitchError: (sessionId: string, error: string | null) => void
  setCommitLogLoading: (sessionId: string) => void
  setCommitLogResult: (sessionId: string, r: { state: DiffState; commits: CommitLogEntry[]; error?: string }) => void
  setViewingCommit: (sessionId: string, sha: string | null) => void
  setCommitDiffLoading: (sessionId: string) => void
  setCommitDiffResult: (sessionId: string, r: { state: DiffState; files?: DiffFile[]; error?: string }) => void
  setDiscardPending: (sessionId: string, path: string, pending: boolean) => void
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
  setCollapsed: (id, collapsed) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, collapsed })) })),
  clearSession: (id) => set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_DIFF } })),
  setGitState: (id, isGitRepo, currentBranch) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, isGitRepo, currentBranch })) })),
  setBranches: (id, branches, currentBranch) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, branches, currentBranch, switchError: null })) })),
  setSwitchError: (id, error) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, switchError: error })) })),
  setCommitLogLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitLog: { ...s.commitLog, status: 'loading' } })) })),
  setCommitLogResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitLog: { status: 'ready', state: r.state, commits: r.commits, error: r.error } })) })),
  setViewingCommit: (id, sha) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, viewingCommitSha: sha })) })),
  setCommitDiffLoading: (id) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitDiff: { ...s.commitDiff, status: 'loading' } })) })),
  setCommitDiffResult: (id, r) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, commitDiff: { status: 'ready', state: r.state, files: r.files ?? [], error: r.error } })) })),
  setDiscardPending: (id, p, pending) => set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, discardPending: { ...s.discardPending, [p]: pending } })) })),
  resetTransient: () => set((st) => ({
    bySession: Object.fromEntries(Object.entries(st.bySession).map(([id, s]) => [id, { ...s, status: s.status === 'loading' ? 'idle' : s.status, initPending: false }])),
  })),
}))
