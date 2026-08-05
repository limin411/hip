import { create } from 'zustand'

export type GoalUiStatus = 'active' | 'paused' | 'blocked' | 'completed' | 'failed'

export interface SessionGoal {
  id: string
  description: string
  status: GoalUiStatus
  turns?: number
  maxTurns?: number
  activePhaseTitle?: string
  openTodoCount?: number
  criteriaDone?: number
  criteriaTotal?: number
  lastVerifyOk?: boolean
}

interface GoalState {
  /** sessionId → current goal (product chrome). */
  bySession: Record<string, SessionGoal | null>
  setGoal: (sessionId: string, goal: SessionGoal | null) => void
  updateStatus: (sessionId: string, status: GoalUiStatus) => void
  clear: (sessionId: string) => void
}

export const useGoalStore = create<GoalState>((set) => ({
  bySession: {},

  setGoal: (sessionId, goal) =>
    set((s) => ({
      bySession: { ...s.bySession, [sessionId]: goal },
    })),

  updateStatus: (sessionId, status) =>
    set((s) => {
      const cur = s.bySession[sessionId]
      if (!cur) return s
      if (status === 'completed') {
        return { bySession: { ...s.bySession, [sessionId]: null } }
      }
      return { bySession: { ...s.bySession, [sessionId]: { ...cur, status } } }
    }),

  clear: (sessionId) =>
    set((s) => {
      const next = { ...s.bySession }
      delete next[sessionId]
      return { bySession: next }
    }),
}))
