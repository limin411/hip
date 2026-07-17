import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ParallelSlotStatus = 'creating' | 'ready' | 'error'

export interface ParallelSlot {
  index: number
  sessionId: string
  worktreePath: string
  branch: string
  status: ParallelSlotStatus
  error?: string
}

export interface ParallelRun {
  id: string
  baseCwd: string
  prompt: string
  hostSessionId: string
  slots: ParallelSlot[]
  selectedSessionId?: string
  createdAt: number
  /** Soft error for the whole run (e.g. host failed). */
  error?: string
}

interface ParallelState {
  runs: ParallelRun[]
  addRun: (run: ParallelRun) => void
  updateRun: (id: string, patch: Partial<ParallelRun>) => void
  setSlot: (runId: string, index: number, patch: Partial<ParallelSlot>) => void
  selectWinner: (runId: string, sessionId: string) => void
  removeRun: (id: string) => void
  findRunBySessionId: (sessionId: string) => ParallelRun | undefined
  pruneMissingSessions: (existingIds: Set<string>) => void
}

const MAX_RUNS = 30

export const useParallelStore = create<ParallelState>()(
  persist(
    (set, get) => ({
      runs: [],

      addRun: (run) => {
        set((st) => ({
          runs: [run, ...st.runs].slice(0, MAX_RUNS),
        }))
      },

      updateRun: (id, patch) => {
        set((st) => ({
          runs: st.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }))
      },

      setSlot: (runId, index, patch) => {
        set((st) => ({
          runs: st.runs.map((r) => {
            if (r.id !== runId) return r
            const existing = r.slots.find((s) => s.index === index)
            if (!existing) {
              const next: ParallelSlot = {
                index,
                sessionId: '',
                worktreePath: '',
                branch: '',
                status: 'creating',
                ...patch,
              }
              return { ...r, slots: [...r.slots, next].sort((a, b) => a.index - b.index) }
            }
            return {
              ...r,
              slots: r.slots
                .map((s) => (s.index === index ? { ...s, ...patch } : s))
                .sort((a, b) => a.index - b.index),
            }
          }),
        }))
      },

      selectWinner: (runId, sessionId) => {
        set((st) => ({
          runs: st.runs.map((r) =>
            r.id === runId ? { ...r, selectedSessionId: sessionId } : r,
          ),
        }))
      },

      removeRun: (id) => {
        set((st) => ({ runs: st.runs.filter((r) => r.id !== id) }))
      },

      findRunBySessionId: (sessionId) => {
        return get().runs.find(
          (r) => r.hostSessionId === sessionId || r.slots.some((s) => s.sessionId === sessionId),
        )
      },

      pruneMissingSessions: (existingIds) => {
        set((st) => ({
          runs: st.runs
            .map((r) => ({
              ...r,
              slots: r.slots.filter((s) => !s.sessionId || existingIds.has(s.sessionId)),
            }))
            .filter((r) => r.slots.length > 0 || existingIds.has(r.hostSessionId)),
        }))
      },
    }),
    {
      name: 'hip-parallel-runs',
      partialize: (s) => ({ runs: s.runs }),
    },
  ),
)

/** Default / clamp fan-out size for Parallel Studio. */
export function clampParallelCount(n: number): number {
  if (!Number.isFinite(n)) return 2
  return Math.min(4, Math.max(2, Math.floor(n)))
}
