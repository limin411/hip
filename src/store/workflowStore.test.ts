// src/store/workflowStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkflowStore } from './workflowStore'
import type { WorkflowDef } from '@hip/protocol'

const mockWorkflow: WorkflowDef = {
  id: 'wf-1',
  name: 'Test',
  nodes: [{ id: 'n1', type: 'agent', agentId: 'coder', inputTemplate: 'code' } as const],
  edges: [],
  entry: ['n1'],
}

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ activeWorkflow: null, runState: null })
  })

  describe('setActiveWorkflow', () => {
    it('sets activeWorkflow and initializes pending runState', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      const s = useWorkflowStore.getState()
      expect(s.activeWorkflow).toEqual(mockWorkflow)
      expect(s.runState).toEqual({
        runId: '',
        workflowId: 'wf-1',
        status: 'pending',
        nodes: {},
      })
    })

    it('clears both activeWorkflow and runState when null is passed', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().setActiveWorkflow(null)
      const s = useWorkflowStore.getState()
      expect(s.activeWorkflow).toBeNull()
      expect(s.runState).toBeNull()
    })
  })

  describe('applyEvent', () => {
    it('is a no-op when runState is null', () => {
      useWorkflowStore.getState().applyEvent({ type: 'run:started' })
      expect(useWorkflowStore.getState().runState).toBeNull()
    })

    it('run:started transitions status to running', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'run:started' })
      expect(useWorkflowStore.getState().runState?.status).toBe('running')
    })

    it('run:finished transitions status to the given status', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'run:finished', status: 'succeeded' })
      expect(useWorkflowStore.getState().runState?.status).toBe('succeeded')
    })

    it('run:cancelled transitions status to cancelled', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'run:cancelled' })
      expect(useWorkflowStore.getState().runState?.status).toBe('cancelled')
    })

    it('node:started sets node status to running', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'node:started', nodeId: 'n1' })
      expect(useWorkflowStore.getState().runState?.nodes.n1?.status).toBe('running')
    })

    it('node:succeeded sets node output and status to succeeded', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'node:succeeded', nodeId: 'n1', output: { text: 'done', data: { ok: true } } })
      const n = useWorkflowStore.getState().runState?.nodes.n1
      expect(n?.status).toBe('succeeded')
      expect(n?.output).toEqual({ text: 'done', data: { ok: true } })
    })

    it('node:failed sets node error and status to failed', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'node:failed', nodeId: 'n1', error: 'something broke' })
      const n = useWorkflowStore.getState().runState?.nodes.n1
      expect(n?.status).toBe('failed')
      expect(n?.error).toBe('something broke')
    })

    it('node:skipped sets node status to skipped', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().applyEvent({ type: 'node:skipped', nodeId: 'n1' })
      expect(useWorkflowStore.getState().runState?.nodes.n1?.status).toBe('skipped')
    })

    it('preserves other node states when updating one node', () => {
      useWorkflowStore.getState().setActiveWorkflow({
        ...mockWorkflow,
        nodes: [
          ...mockWorkflow.nodes,
          { id: 'n2', type: 'tool' as const, toolName: 'read', inputTemplate: 'file' },
        ],
      })
      useWorkflowStore.getState().applyEvent({ type: 'node:started', nodeId: 'n1' })
      expect(useWorkflowStore.getState().runState?.nodes.n1?.status).toBe('running')
      // n2 should still be untouched (undefined in the initial runState.nodes)
    })
  })

  describe('setRunState', () => {
    it('replaces the entire runState', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      const snap = { runId: 'r99', workflowId: 'wf-1', status: 'failed' as const, nodes: { n1: { status: 'failed' as const, error: 'boom' } } }
      useWorkflowStore.getState().setRunState(snap)
      expect(useWorkflowStore.getState().runState).toEqual(snap)
    })

    it('can clear runState with null', () => {
      useWorkflowStore.getState().setActiveWorkflow(mockWorkflow)
      useWorkflowStore.getState().setRunState(null)
      expect(useWorkflowStore.getState().runState).toBeNull()
    })
  })
})
