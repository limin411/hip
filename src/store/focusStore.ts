import { create } from 'zustand'

/** Deferred write-follow: open panel at turn end unless a run_script consumed the path. */
export interface DeferredWriteFollow {
  sessionId: string
  path: string
  callId: string
}

/** Shared focus across transcript ↔ workbench (spec U10). */
interface FocusState {
  focusedCallId: string | null
  focusedPath: string | null
  /** When true, auto-follow writes is paused for the current turn. */
  followPaused: boolean
  /**
   * User closed the right panel this turn — do not auto-reopen until the next
   * user turn (resetFollowForTurn).
   */
  panelDismissedThisTurn: boolean
  autoFollowEdits: boolean
  /**
   * Script-like write waiting for turn end (or cancel via run_script).
   * Last write wins within a turn.
   */
  deferredWriteFollow: DeferredWriteFollow | null
  setFocusedCallId: (id: string | null) => void
  setFocusedPath: (path: string | null, opts?: { userInitiated?: boolean }) => void
  setAutoFollowEdits: (v: boolean) => void
  /** User closed code/chat right panel — suppress auto-open for the rest of the turn. */
  dismissPanelThisTurn: () => void
  setDeferredWriteFollow: (v: DeferredWriteFollow | null) => void
  clearDeferredWriteFollow: () => void
  /** Call at turn start to re-enable follow. */
  resetFollowForTurn: () => void
  clearFocus: () => void
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedCallId: null,
  focusedPath: null,
  followPaused: false,
  panelDismissedThisTurn: false,
  autoFollowEdits: true,
  deferredWriteFollow: null,

  setFocusedCallId: (id) => set({ focusedCallId: id }),
  setFocusedPath: (path, opts) =>
    set((s) => ({
      focusedPath: path,
      followPaused: opts?.userInitiated ? true : s.followPaused,
    })),
  setAutoFollowEdits: (v) => set({ autoFollowEdits: v }),
  dismissPanelThisTurn: () => set({ panelDismissedThisTurn: true, deferredWriteFollow: null }),
  setDeferredWriteFollow: (v) => set({ deferredWriteFollow: v }),
  clearDeferredWriteFollow: () => set({ deferredWriteFollow: null }),
  resetFollowForTurn: () =>
    set({ followPaused: false, panelDismissedThisTurn: false, deferredWriteFollow: null }),
  clearFocus: () =>
    set({
      focusedCallId: null,
      focusedPath: null,
      followPaused: false,
      panelDismissedThisTurn: false,
      deferredWriteFollow: null,
    }),
}))
