import { create } from 'zustand'

/**
 * Lightweight badge counts for the Recycle Bin footer entry.
 * Sessions (WS) only.
 */
interface TrashBadgeState {
  sessionCount: number
  setSessionCount: (n: number) => void
  adjustSessions: (delta: number) => void
}

export const useTrashBadgeStore = create<TrashBadgeState>((set) => ({
  sessionCount: 0,
  setSessionCount: (n) => set({ sessionCount: Math.max(0, n) }),
  adjustSessions: (delta) =>
    set((s) => ({ sessionCount: Math.max(0, s.sessionCount + delta) })),
}))

export function trashBadgeTotal(sessionCount: number): number {
  return Math.max(0, sessionCount)
}

/** Display string for footer badge; empty when zero. */
export function formatTrashBadge(total: number): string {
  if (total <= 0) return ''
  if (total >= 100) return '99+'
  return String(total)
}
