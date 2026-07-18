import { create } from 'zustand'

/** Shared focus across transcript ↔ workbench (spec U10). */
interface FocusState {
  focusedCallId: string | null
  focusedAgentId: string | null
  focusedPath: string | null
  /** When true, auto-follow writes is paused for the current turn. */
  followPaused: boolean
  autoFollowEdits: boolean
  setFocusedCallId: (id: string | null) => void
  setFocusedAgentId: (id: string | null) => void
  setFocusedPath: (path: string | null, opts?: { userInitiated?: boolean }) => void
  setAutoFollowEdits: (v: boolean) => void
  /** Call at turn start to re-enable follow. */
  resetFollowForTurn: () => void
  clearFocus: () => void
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedCallId: null,
  focusedAgentId: null,
  focusedPath: null,
  followPaused: false,
  autoFollowEdits: true,

  setFocusedCallId: (id) => set({ focusedCallId: id }),
  setFocusedAgentId: (id) => set({ focusedAgentId: id }),
  setFocusedPath: (path, opts) =>
    set((s) => ({
      focusedPath: path,
      followPaused: opts?.userInitiated ? true : s.followPaused,
    })),
  setAutoFollowEdits: (v) => set({ autoFollowEdits: v }),
  resetFollowForTurn: () => set({ followPaused: false }),
  clearFocus: () =>
    set({ focusedCallId: null, focusedAgentId: null, focusedPath: null, followPaused: false }),
}))
