/**
 * Session-scoped TaskRuntime UI state (composer runtime task strip).
 */
import { create } from 'zustand'
import type {
  ServerMessage,
  TaskSnapshot,
  TaskRunningCounts,
  TaskKind,
} from '@hip/protocol'
import { emptyTaskRunningCounts } from '@hip/protocol'

const MAX_EVENT_LINES = 200

export interface TaskEventLine {
  seq: number
  line: string
  at: number
}

interface SessionRuntimeState {
  tasks: Record<string, TaskSnapshot>
  runningCounts: TaskRunningCounts
  events: Record<string, TaskEventLine[]>
  selectedTaskId: string | null
}

interface TaskRuntimeStore {
  bySession: Record<string, SessionRuntimeState>
  applyMessage: (msg: ServerMessage) => void
  selectTask: (sessionId: string, taskId: string | null) => void
  clearSession: (sessionId: string) => void
}

function emptySession(): SessionRuntimeState {
  return {
    tasks: {},
    runningCounts: emptyTaskRunningCounts(),
    events: {},
    selectedTaskId: null,
  }
}

function upsertTask(state: SessionRuntimeState, task: TaskSnapshot): SessionRuntimeState {
  const tasks = { ...state.tasks, [task.id]: task }
  const runningCounts = emptyTaskRunningCounts()
  for (const t of Object.values(tasks)) {
    if (t.kind === 'schedule') {
      if (t.status === 'scheduled' || t.status === 'running') runningCounts.schedule++
      continue
    }
    if (t.status === 'running') {
      if (t.kind === 'shell') runningCounts.shell++
      else if (t.kind === 'agent') runningCounts.agent++
      else if (t.kind === 'monitor') runningCounts.monitor++
    }
  }
  return { ...state, tasks, runningCounts }
}

export const useTaskRuntimeStore = create<TaskRuntimeStore>((set) => ({
  bySession: {},

  applyMessage(msg) {
    if (
      msg.type !== 'task:snapshot' &&
      msg.type !== 'task:delta' &&
      msg.type !== 'task:event' &&
      msg.type !== 'task:notification'
    ) {
      return
    }
    const sessionId = msg.sessionId
    set((s) => {
      const cur = s.bySession[sessionId] ?? emptySession()
      if (msg.type === 'task:snapshot') {
        const tasks: Record<string, TaskSnapshot> = {}
        for (const t of msg.tasks) tasks[t.id] = t
        // Forward-compat: unknown kinds still stored as-is via TaskSnapshot typing
        return {
          bySession: {
            ...s.bySession,
            [sessionId]: {
              ...cur,
              tasks,
              runningCounts: msg.runningCounts,
            },
          },
        }
      }
      if (msg.type === 'task:delta') {
        return {
          bySession: {
            ...s.bySession,
            [sessionId]: upsertTask(cur, msg.task),
          },
        }
      }
      if (msg.type === 'task:event') {
        const prev = cur.events[msg.taskId] ?? []
        const next = [...prev, { seq: msg.seq, line: msg.line, at: Date.now() }].slice(-MAX_EVENT_LINES)
        return {
          bySession: {
            ...s.bySession,
            [sessionId]: {
              ...cur,
              events: { ...cur.events, [msg.taskId]: next },
            },
          },
        }
      }
      // task:notification — ensure terminal status reflected if delta missed
      if (msg.type === 'task:notification') {
        const existing = cur.tasks[msg.taskId]
        const task: TaskSnapshot = existing
          ? {
              ...existing,
              status: msg.status === 'suppressed' ? 'suppressed' : msg.status,
              updatedAt: Date.now(),
              detail: msg.error ?? existing.detail,
            }
          : {
              id: msg.taskId,
              kind: msg.kind,
              description: msg.description,
              status: msg.status === 'suppressed' ? 'suppressed' : msg.status,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
        return {
          bySession: {
            ...s.bySession,
            [sessionId]: upsertTask(cur, task),
          },
        }
      }
      return s
    })
  },

  selectTask(sessionId, taskId) {
    set((s) => {
      const cur = s.bySession[sessionId] ?? emptySession()
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: { ...cur, selectedTaskId: taskId },
        },
      }
    })
  },

  clearSession(sessionId) {
    set((s) => {
      const next = { ...s.bySession }
      delete next[sessionId]
      return { bySession: next }
    })
  },
}))

/** Kind filter helper for unknown future kinds. */
export function isKnownTaskKind(k: string): k is TaskKind {
  return k === 'shell' || k === 'agent' || k === 'monitor' || k === 'schedule'
}

