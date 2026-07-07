import { create } from 'zustand'
import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'

export interface WorkflowState {
  /** The current active workflow definition, if any. */
  activeWorkflow: WorkflowDef | null
  /** The current run state, updated as OrchestratorEvents arrive. */
  runState: RunState | null
  /** Set a new active workflow (clears previous run state). */
  setActiveWorkflow: (def: WorkflowDef | null) => void
  /** Update run state from an orchestrator event. */
  applyEvent: (evt: OrchestratorEvent) => void
  /** Overwrite the full run state snapshot (e.g. on reconnect). */
  setRunState: (state: RunState | null) => void
}

export const useWorkflowStore = create<WorkflowState>()((set) => ({
  activeWorkflow: null,
  runState: null,

  setActiveWorkflow: (def) =>
    set({ activeWorkflow: def, runState: def ? { runId: '', workflowId: def.id, status: 'pending', nodes: {} } : null }),

  applyEvent: (evt) =>
    set((s) => {
      if (!s.runState) return s
      const rs = { ...s.runState, nodes: { ...s.runState.nodes } }
      switch (evt.type) {
        case 'run:started':
          rs.status = 'running'
          break
        case 'run:finished':
          rs.status = evt.status
          break
        case 'run:cancelled':
          rs.status = 'cancelled'
          break
        case 'node:started':
          rs.nodes[evt.nodeId] = { ...rs.nodes[evt.nodeId], status: 'running' }
          break
        case 'node:succeeded':
          rs.nodes[evt.nodeId] = { status: 'succeeded', output: evt.output }
          break
        case 'node:failed':
          rs.nodes[evt.nodeId] = { status: 'failed', error: evt.error }
          break
        case 'node:skipped':
          rs.nodes[evt.nodeId] = { status: 'skipped' }
          break
      }
      return { runState: rs }
    }),

  setRunState: (state) => set({ runState: state }),
}))
