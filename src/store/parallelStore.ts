import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ParallelSlotStatus = 'creating' | 'ready' | 'error'

export interface ParallelSlot {
  index: number
  /** Multi-session host path (legacy); agent-driven path may leave empty. */
  sessionId: string
  /** Background worker id from parallel_worktrees. */
  taskId?: string
  /** Catalog id when created via WorktreeService (PR5). */
  worktreeId?: string
  worktreePath: string
  branch: string
  status: ParallelSlotStatus
  error?: string
}

export interface ParallelRun {
  id: string
  baseCwd: string
  prompt: string
  /** Parent chat session that requested the run (agent-driven). */
  hostSessionId: string
  slots: ParallelSlot[]
  selectedSessionId?: string
  createdAt: number
  /** Soft error for the whole run (e.g. host failed). */
  error?: string
  /** agent = parallel_worktrees tool; host = multi-session fan-out (legacy). */
  source?: 'agent' | 'host'
}

interface ParallelState {
  runs: ParallelRun[]
  addRun: (run: ParallelRun) => void
  updateRun: (id: string, patch: Partial<ParallelRun>) => void
  setSlot: (runId: string, index: number, patch: Partial<ParallelSlot>) => void
  selectWinner: (runId: string, sessionId: string) => void
  removeRun: (id: string) => void
  findRunBySessionId: (sessionId: string) => ParallelRun | undefined
  /** All parallel runs hosted by this session (agent-driven worktrees). */
  runsForHost: (sessionId: string) => ParallelRun[]
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

      runsForHost: (sessionId) => {
        return get().runs.filter((r) => r.hostSessionId === sessionId && r.slots.length > 0)
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

/** Re-export shared clamp (MIN=1, MAX=4). Prefer `@/lib/parallelCount` for new code. */
export { clampParallelCount } from '@/lib/parallelCount'

/** Flatten slots for a host session (newest run first). */
export function slotsForHost(
  runs: ParallelRun[],
  hostSessionId: string,
): Array<ParallelSlot & { runId: string }> {
  return runs
    .filter((r) => r.hostSessionId === hostSessionId)
    .flatMap((r) => r.slots.map((s) => ({ ...s, runId: r.id })))
    .sort((a, b) => a.index - b.index || a.runId.localeCompare(b.runId))
}

/** Short label for worktree path (last 1–2 segments). */
export function shortWorktreeLabel(worktreePath: string, branch: string): string {
  if (!worktreePath) return branch || 'worktree'
  const parts = worktreePath.split(/[/\\]/).filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return parts[parts.length - 1] || branch
}
