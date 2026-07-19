import { create } from 'zustand'

/**
 * Lightweight badge counts for the Recycle Bin footer entry.
 * Knowledge counts stay 0 until PR4 wires quarantine list.
 */
interface TrashBadgeState {
  sessionCount: number
  knowledgeCount: number
  setSessionCount: (n: number) => void
  setKnowledgeCount: (n: number) => void
  setFromLists: (sessionCount: number, knowledgeCount: number) => void
  adjustSessions: (delta: number) => void
  adjustKnowledge: (delta: number) => void
}

export const useTrashBadgeStore = create<TrashBadgeState>((set) => ({
  sessionCount: 0,
  knowledgeCount: 0,
  setSessionCount: (n) => set({ sessionCount: Math.max(0, n) }),
  setKnowledgeCount: (n) => set({ knowledgeCount: Math.max(0, n) }),
  setFromLists: (sessionCount, knowledgeCount) =>
    set({
      sessionCount: Math.max(0, sessionCount),
      knowledgeCount: Math.max(0, knowledgeCount),
    }),
  adjustSessions: (delta) =>
    set((s) => ({ sessionCount: Math.max(0, s.sessionCount + delta) })),
  adjustKnowledge: (delta) =>
    set((s) => ({ knowledgeCount: Math.max(0, s.knowledgeCount + delta) })),
}))

export function trashBadgeTotal(sessionCount: number, knowledgeCount: number): number {
  return Math.max(0, sessionCount) + Math.max(0, knowledgeCount)
}

/** Display string for footer badge; empty when zero. */
export function formatTrashBadge(total: number): string {
  if (total <= 0) return ''
  if (total >= 100) return '99+'
  return String(total)
}
