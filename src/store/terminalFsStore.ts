import { create } from 'zustand'
import type { SftpEntry } from '@/ipc/sftp'

export type TransferPhase = 'started' | 'progress' | 'completed' | 'cancelled' | 'error' | string

export interface TerminalTransfer {
  opId: string
  terminalId: string
  kind: 'download' | 'upload'
  label: string
  phase: TransferPhase
  bytes: number
  total?: number
  message?: string
}

interface TerminalFsSlice {
  entriesByDir: Record<string, SftpEntry[]>
  expanded: Record<string, boolean>
  /** Resolved absolute remote root for this terminal (after first ls). */
  rootPath: string | null
  loading: Record<string, boolean>
  /** Nested expand failures (Issue 7). */
  dirErrors: Record<string, string>
  error: string | null
  /** Navigation history for back/forward. */
  navigationHistory: string[]
  /** Current index in navigation history. */
  historyIndex: number
}

const EMPTY: TerminalFsSlice = {
  entriesByDir: {},
  expanded: {},
  rootPath: null,
  loading: {},
  dirErrors: {},
  error: null,
  navigationHistory: [],
  historyIndex: -1,
}

interface TerminalFsStore {
  byTerminal: Record<string, TerminalFsSlice>
  transfers: TerminalTransfer[]

  getSlice: (terminalId: string) => TerminalFsSlice
  setEntries: (terminalId: string, dir: string, entries: SftpEntry[]) => void
  setRootPath: (terminalId: string, root: string) => void
  setLoading: (terminalId: string, dir: string, loading: boolean) => void
  setError: (terminalId: string, error: string | null) => void
  setDirError: (terminalId: string, dir: string, error: string | null) => void
  toggleExpanded: (terminalId: string, dir: string) => void
  clearTerminal: (terminalId: string) => void

  upsertTransfer: (t: TerminalTransfer) => void
  removeTransfer: (opId: string) => void
  clearTransfersFor: (terminalId: string) => void

  /** Navigation history management */
  pushNavigation: (terminalId: string, path: string) => void
  goBack: (terminalId: string) => string | null
  goForward: (terminalId: string) => string | null
  canGoBack: (terminalId: string) => boolean
  canGoForward: (terminalId: string) => boolean
}

function patch(
  by: Record<string, TerminalFsSlice>,
  id: string,
  fn: (s: TerminalFsSlice) => TerminalFsSlice,
): Record<string, TerminalFsSlice> {
  return { ...by, [id]: fn(by[id] ?? EMPTY) }
}

export const useTerminalFsStore = create<TerminalFsStore>((set, get) => ({
  byTerminal: {},
  transfers: [],

  getSlice: (id) => get().byTerminal[id] ?? EMPTY,

  setEntries: (id, dir, entries) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({
        ...s,
        entriesByDir: { ...s.entriesByDir, [dir]: entries },
        error: null,
      })),
    })),

  setRootPath: (id, root) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({ ...s, rootPath: root })),
    })),

  setLoading: (id, dir, loading) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({
        ...s,
        loading: { ...s.loading, [dir]: loading },
      })),
    })),

  setError: (id, error) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({ ...s, error })),
    })),

  setDirError: (id, dir, error) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => {
        const dirErrors = { ...s.dirErrors }
        if (error == null) delete dirErrors[dir]
        else dirErrors[dir] = error
        return { ...s, dirErrors }
      }),
    })),

  toggleExpanded: (id, dir) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({
        ...s,
        expanded: { ...s.expanded, [dir]: !s.expanded[dir] },
      })),
    })),

  clearTerminal: (id) =>
    set((st) => {
      const next = { ...st.byTerminal }
      delete next[id]
      return {
        byTerminal: next,
        transfers: st.transfers.filter((t) => t.terminalId !== id),
      }
    }),

  upsertTransfer: (t) =>
    set((st) => {
      const i = st.transfers.findIndex((x) => x.opId === t.opId)
      if (i < 0) return { transfers: [...st.transfers, t] }
      const transfers = st.transfers.slice()
      transfers[i] = { ...transfers[i], ...t }
      return { transfers }
    }),

  removeTransfer: (opId) =>
    set((st) => ({ transfers: st.transfers.filter((t) => t.opId !== opId) })),

  clearTransfersFor: (terminalId) =>
    set((st) => ({
      transfers: st.transfers.filter((t) => t.terminalId !== terminalId),
    })),

  pushNavigation: (id, path) =>
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => {
        const newHistory = s.navigationHistory.slice(0, s.historyIndex + 1)
        newHistory.push(path)
        return {
          ...s,
          navigationHistory: newHistory,
          historyIndex: newHistory.length - 1,
        }
      }),
    })),

  goBack: (id) => {
    const slice = get().byTerminal[id] ?? EMPTY
    if (slice.historyIndex <= 0) return null
    const newIndex = slice.historyIndex - 1
    const path = slice.navigationHistory[newIndex]
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({
        ...s,
        historyIndex: newIndex,
      })),
    }))
    return path
  },

  goForward: (id) => {
    const slice = get().byTerminal[id] ?? EMPTY
    if (slice.historyIndex >= slice.navigationHistory.length - 1) return null
    const newIndex = slice.historyIndex + 1
    const path = slice.navigationHistory[newIndex]
    set((st) => ({
      byTerminal: patch(st.byTerminal, id, (s) => ({
        ...s,
        historyIndex: newIndex,
      })),
    }))
    return path
  },

  canGoBack: (id) => {
    const slice = get().byTerminal[id] ?? EMPTY
    return slice.historyIndex > 0
  },

  canGoForward: (id) => {
    const slice = get().byTerminal[id] ?? EMPTY
    return slice.historyIndex < slice.navigationHistory.length - 1
  },
}))
