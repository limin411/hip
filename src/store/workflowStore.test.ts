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

const SID = 'sess-1'

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ bySession: {} })
  })

  describe('setActiveWorkflow', () => {
    it('sets activeWorkflow and initializes pending runState', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      const slice = useWorkflowStore.getState().getSession(SID)
      expect(slice.activeWorkflow).toEqual(mockWorkflow)
      expect(slice.runId).toBe('r-1')
      expect(slice.runState).toEqual({
        runId: 'r-1',
        workflowId: 'wf-1',
        status: 'pending',
        nodes: {},
      })
    })

    it('defaults runId to empty string when omitted', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow)
      const slice = useWorkflowStore.getState().getSession(SID)
      expect(slice.runId).toBe('')
      expect(slice.runState?.runId).toBe('')
    })

    it('clears session slice when null is passed', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().setActiveWorkflow(SID, null)
      const slice = useWorkflowStore.getState().getSession(SID)
      expect(slice.activeWorkflow).toBeNull()
      expect(slice.runState).toBeNull()
      expect(slice.runId).toBeNull()
    })
  })

  describe('applyEvent', () => {
    it('is a no-op when runState is null', () => {
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'run:started' })
      expect(useWorkflowStore.getState().getSession(SID).runState).toBeNull()
    })

    it('is a no-op when session is missing', () => {
      useWorkflowStore.getState().applyEvent('missing', 'r-1', { type: 'run:started' })
      expect(useWorkflowStore.getState().bySession['missing']).toBeUndefined()
    })

    it('ignores events with a different runId when cur.runId is set', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-stale', { type: 'run:started' })
      expect(useWorkflowStore.getState().getSession(SID).runState?.status).toBe('pending')
    })

    it('accepts events when cur.runId is empty and stamps runId from event', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow)
      useWorkflowStore.getState().applyEvent(SID, 'r-new', { type: 'run:started' })
      const slice = useWorkflowStore.getState().getSession(SID)
      expect(slice.runState?.status).toBe('running')
      expect(slice.runId).toBe('r-new')
    })

    it('run:started transitions status to running', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'run:started' })
      expect(useWorkflowStore.getState().getSession(SID).runState?.status).toBe('running')
    })

    it('run:finished transitions status to the given status', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'run:finished', status: 'succeeded' })
      expect(useWorkflowStore.getState().getSession(SID).runState?.status).toBe('succeeded')
    })

    it('run:cancelled transitions status to cancelled', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'run:cancelled' })
      expect(useWorkflowStore.getState().getSession(SID).runState?.status).toBe('cancelled')
    })

    it('node:started sets node status to running', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'node:started', nodeId: 'n1' })
      expect(useWorkflowStore.getState().getSession(SID).runState?.nodes.n1?.status).toBe('running')
    })

    it('node:succeeded sets node output and status to succeeded', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', {
        type: 'node:succeeded',
        nodeId: 'n1',
        output: { text: 'done', data: { ok: true } },
      })
      const n = useWorkflowStore.getState().getSession(SID).runState?.nodes.n1
      expect(n?.status).toBe('succeeded')
      expect(n?.output).toEqual({ text: 'done', data: { ok: true } })
    })

    it('node:failed sets node error and status to failed', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', {
        type: 'node:failed',
        nodeId: 'n1',
        error: 'something broke',
      })
      const n = useWorkflowStore.getState().getSession(SID).runState?.nodes.n1
      expect(n?.status).toBe('failed')
      expect(n?.error).toBe('something broke')
    })

    it('node:skipped sets node status to skipped', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'node:skipped', nodeId: 'n1' })
      expect(useWorkflowStore.getState().getSession(SID).runState?.nodes.n1?.status).toBe('skipped')
    })

    it('preserves other node states when updating one node', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, {
        ...mockWorkflow,
        nodes: [
          ...mockWorkflow.nodes,
          { id: 'n2', type: 'tool' as const, toolName: 'read', inputTemplate: 'file' },
        ],
      }, 'r-1')
      useWorkflowStore.getState().applyEvent(SID, 'r-1', { type: 'node:started', nodeId: 'n1' })
      useWorkflowStore.getState().applyEvent(SID, 'r-1', {
        type: 'node:succeeded',
        nodeId: 'n2',
        output: { text: 'ok' },
      })
      const nodes = useWorkflowStore.getState().getSession(SID).runState?.nodes
      expect(nodes?.n1?.status).toBe('running')
      expect(nodes?.n2?.status).toBe('succeeded')
    })
  })

  describe('setSnapshot', () => {
    it('replaces def, state, and runId', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-old')
      const snap = {
        runId: 'r99',
        workflowId: 'wf-1',
        status: 'failed' as const,
        nodes: { n1: { status: 'failed' as const, error: 'boom' } },
      }
      useWorkflowStore.getState().setSnapshot(SID, mockWorkflow, snap)
      const slice = useWorkflowStore.getState().getSession(SID)
      expect(slice.activeWorkflow).toEqual(mockWorkflow)
      expect(slice.runState).toEqual(snap)
      expect(slice.runId).toBe('r99')
    })
  })

  describe('clearSession', () => {
    it('removes the session key', () => {
      useWorkflowStore.getState().setActiveWorkflow(SID, mockWorkflow, 'r-1')
      useWorkflowStore.getState().clearSession(SID)
      expect(useWorkflowStore.getState().bySession[SID]).toBeUndefined()
      // getSession still returns empty default
      expect(useWorkflowStore.getState().getSession(SID)).toEqual({
        activeWorkflow: null,
        runState: null,
        runId: null,
      })
    })
  })

  describe('getSession', () => {
    it('returns empty default when session is missing', () => {
      expect(useWorkflowStore.getState().getSession('nope')).toEqual({
        activeWorkflow: null,
        runState: null,
        runId: null,
      })
    })
  })

  describe('session isolation', () => {
    it('isolates two sessions', () => {
      useWorkflowStore.getState().setActiveWorkflow('a', mockWorkflow, 'r-a')
      useWorkflowStore.getState().setActiveWorkflow('b', mockWorkflow, 'r-b')
      useWorkflowStore.getState().applyEvent('a', 'r-a', { type: 'run:started' })
      expect(useWorkflowStore.getState().getSession('a').runState?.status).toBe('running')
      expect(useWorkflowStore.getState().getSession('b').runState?.status).toBe('pending')
    })

    it('clearSession only affects the target session', () => {
      useWorkflowStore.getState().setActiveWorkflow('a', mockWorkflow, 'r-a')
      useWorkflowStore.getState().setActiveWorkflow('b', mockWorkflow, 'r-b')
      useWorkflowStore.getState().clearSession('a')
      expect(useWorkflowStore.getState().bySession['a']).toBeUndefined()
      expect(useWorkflowStore.getState().getSession('b').runId).toBe('r-b')
    })
  })
})
