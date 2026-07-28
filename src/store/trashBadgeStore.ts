import { create } from 'zustand'

/**
 * Lightweight badge counts for the Recycle Bin footer entry.
 * Sessions (WS) + knowledge + work items + automations (Tauri trash).
 */
interface TrashBadgeState {
  sessionCount: number
  knowledgeCount: number
  workItemCount: number
  automationCount: number
  setSessionCount: (n: number) => void
  setKnowledgeCount: (n: number) => void
  setWorkItemCount: (n: number) => void
  setAutomationCount: (n: number) => void
  setFromLists: (
    sessionCount: number,
    knowledgeCount: number,
    workItemCount?: number,
    automationCount?: number,
  ) => void
  adjustSessions: (delta: number) => void
  adjustKnowledge: (delta: number) => void
  adjustWorkItems: (delta: number) => void
  adjustAutomations: (delta: number) => void
}

export const useTrashBadgeStore = create<TrashBadgeState>((set) => ({
  sessionCount: 0,
  knowledgeCount: 0,
  workItemCount: 0,
  automationCount: 0,
  setSessionCount: (n) => set({ sessionCount: Math.max(0, n) }),
  setKnowledgeCount: (n) => set({ knowledgeCount: Math.max(0, n) }),
  setWorkItemCount: (n) => set({ workItemCount: Math.max(0, n) }),
  setAutomationCount: (n) => set({ automationCount: Math.max(0, n) }),
  setFromLists: (sessionCount, knowledgeCount, workItemCount, automationCount) =>
    set((s) => ({
      sessionCount: Math.max(0, sessionCount),
      knowledgeCount: Math.max(0, knowledgeCount),
      workItemCount:
        workItemCount === undefined ? s.workItemCount : Math.max(0, workItemCount),
      automationCount:
        automationCount === undefined
          ? s.automationCount
          : Math.max(0, automationCount),
    })),
  adjustSessions: (delta) =>
    set((s) => ({ sessionCount: Math.max(0, s.sessionCount + delta) })),
  adjustKnowledge: (delta) =>
    set((s) => ({ knowledgeCount: Math.max(0, s.knowledgeCount + delta) })),
  adjustWorkItems: (delta) =>
    set((s) => ({ workItemCount: Math.max(0, s.workItemCount + delta) })),
  adjustAutomations: (delta) =>
    set((s) => ({ automationCount: Math.max(0, s.automationCount + delta) })),
}))

export function trashBadgeTotal(
  sessionCount: number,
  knowledgeCount: number,
  workItemCount = 0,
  automationCount = 0,
): number {
  return (
    Math.max(0, sessionCount) +
    Math.max(0, knowledgeCount) +
    Math.max(0, workItemCount) +
    Math.max(0, automationCount)
  )
}

/** Display string for footer badge; empty when zero. */
export function formatTrashBadge(total: number): string {
  if (total <= 0) return ''
  if (total >= 100) return '99+'
  return String(total)
}
