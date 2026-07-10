import { create } from 'zustand'
import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'

export interface SessionWorkflowSlice {
  activeWorkflow: WorkflowDef | null
  runState: RunState | null
  runId: string | null
}

interface WorkflowStoreState {
  bySession: Record<string, SessionWorkflowSlice>
  setActiveWorkflow: (sessionId: string, def: WorkflowDef | null, runId?: string) => void
  applyEvent: (sessionId: string, runId: string, evt: OrchestratorEvent) => void
  setSnapshot: (sessionId: string, def: WorkflowDef, state: RunState) => void
  clearSession: (sessionId: string) => void
  getSession: (sessionId: string) => SessionWorkflowSlice
}

const empty: SessionWorkflowSlice = { activeWorkflow: null, runState: null, runId: null }

function applyOrchestratorEvent(rs: RunState, evt: OrchestratorEvent): RunState {
  const next = { ...rs, nodes: { ...rs.nodes } }
  switch (evt.type) {
    case 'run:started':
      next.status = 'running'
      break
    case 'run:finished':
      next.status = evt.status
      break
    case 'run:cancelled':
      next.status = 'cancelled'
      break
    case 'node:started':
      next.nodes[evt.nodeId] = { ...next.nodes[evt.nodeId], status: 'running' }
      break
    case 'node:succeeded':
      next.nodes[evt.nodeId] = { status: 'succeeded', output: evt.output }
      break
    case 'node:failed':
      next.nodes[evt.nodeId] = { status: 'failed', error: evt.error }
      break
    case 'node:skipped':
      next.nodes[evt.nodeId] = { status: 'skipped' }
      break
  }
  return next
}

export const useWorkflowStore = create<WorkflowStoreState>()((set, get) => ({
  bySession: {},
  getSession: (sessionId) => get().bySession[sessionId] ?? empty,
  setActiveWorkflow: (sessionId, def, runId = '') =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: def
          ? {
              activeWorkflow: def,
              runId,
              runState: { runId, workflowId: def.id, status: 'pending', nodes: {} },
            }
          : empty,
      },
    })),
  applyEvent: (sessionId, runId, evt) =>
    set((s) => {
      const cur = s.bySession[sessionId]
      if (!cur?.runState) return s
      if (cur.runId && runId && cur.runId !== runId) return s // ignore stale
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...cur,
            runId: cur.runId || runId,
            runState: applyOrchestratorEvent(cur.runState, evt),
          },
        },
      }
    }),
  setSnapshot: (sessionId, def, state) =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: { activeWorkflow: def, runState: state, runId: state.runId },
      },
    })),
  clearSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession
      return { bySession: rest }
    }),
}))
