import { create } from 'zustand'

/**
 * Lightweight badge counts for the Recycle Bin footer entry.
 * Sessions (WS) + knowledge + work items (Tauri trash).
 */
interface TrashBadgeState {
  sessionCount: number
  knowledgeCount: number
  workItemCount: number
  setSessionCount: (n: number) => void
  setKnowledgeCount: (n: number) => void
  setWorkItemCount: (n: number) => void
  setFromLists: (sessionCount: number, knowledgeCount: number, workItemCount?: number) => void
  adjustSessions: (delta: number) => void
  adjustKnowledge: (delta: number) => void
  adjustWorkItems: (delta: number) => void
}

export const useTrashBadgeStore = create<TrashBadgeState>((set) => ({
  sessionCount: 0,
  knowledgeCount: 0,
  workItemCount: 0,
  setSessionCount: (n) => set({ sessionCount: Math.max(0, n) }),
  setKnowledgeCount: (n) => set({ knowledgeCount: Math.max(0, n) }),
  setWorkItemCount: (n) => set({ workItemCount: Math.max(0, n) }),
  setFromLists: (sessionCount, knowledgeCount, workItemCount) =>
    set((s) => ({
      sessionCount: Math.max(0, sessionCount),
      knowledgeCount: Math.max(0, knowledgeCount),
      workItemCount:
        workItemCount === undefined ? s.workItemCount : Math.max(0, workItemCount),
    })),
  adjustSessions: (delta) =>
    set((s) => ({ sessionCount: Math.max(0, s.sessionCount + delta) })),
  adjustKnowledge: (delta) =>
    set((s) => ({ knowledgeCount: Math.max(0, s.knowledgeCount + delta) })),
  adjustWorkItems: (delta) =>
    set((s) => ({ workItemCount: Math.max(0, s.workItemCount + delta) })),
}))

export function trashBadgeTotal(
  sessionCount: number,
  knowledgeCount: number,
  workItemCount = 0,
): number {
  return Math.max(0, sessionCount) + Math.max(0, knowledgeCount) + Math.max(0, workItemCount)
}

/** Display string for footer badge; empty when zero. */
export function formatTrashBadge(total: number): string {
  if (total <= 0) return ''
  if (total >= 100) return '99+'
  return String(total)
}
