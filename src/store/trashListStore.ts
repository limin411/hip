import { create } from 'zustand'
import type { TrashedSessionSummary } from '@hip/protocol'

interface TrashListState {
  sessions: TrashedSessionSummary[]
  loaded: boolean
  setSessions: (sessions: TrashedSessionSummary[]) => void
  removeSession: (id: string) => void
  clear: () => void
}

export const useTrashListStore = create<TrashListState>((set) => ({
  sessions: [],
  loaded: false,
  setSessions: (sessions) => set({ sessions, loaded: true }),
  removeSession: (id) =>
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
  clear: () => set({ sessions: [], loaded: true }),
}))
