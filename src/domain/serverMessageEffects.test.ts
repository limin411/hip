import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useDomainStore } from './sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useUiStore } from '@/store/uiStore'
import type { WorkflowDef } from '@hip/protocol'

const mockDef: WorkflowDef = { id: 'w1', name: 'W', nodes: [], edges: [], entry: [] }

function makeDeps(overrides: Partial<ServerMessageEffectDeps> = {}): ServerMessageEffectDeps & {
  sent: Array<{ type: string; sessionId?: string }>
} {
  const sent: Array<{ type: string; sessionId?: string }> = []
  return {
    sent,
    send: (msg) => { sent.push(msg) },
    requestDiff: vi.fn(),
    requestCheckpoints: vi.fn(),
    requestCommitLog: vi.fn(),
    resyncActiveIfRunning: vi.fn(),
    ...overrides,
  }
}

function seedSession(surface: 'chat' | 'code' = 'code') {
  useDomainStore.setState({
    sessions: [{
      id: 's1',
      config: { llmProvider: 'deepseek', model: '', tools: [], surface },
      title: '',
      preview: '',
      updatedAtMs: 0,
      loaded: true,
      messages: [],
      status: 'idle',
      error: null,
      codePanelOpen: false,
      chatPanelOpen: false,
    }],
    activeSessionId: 's1',
    connection: 'connected',
    searching: false,
    pluginInstall: null,
  })
}

describe('applyServerMessageEffects', () => {
  beforeEach(() => {
    seedSession('code')
    useDiffStore.setState({ bySession: {} })
    useWorkflowStore.setState({ bySession: {} })
    useUiStore.setState({ activeTab: 'files' })
  })

  it('ready resets diff transient and requests session:list', () => {
    const deps = makeDeps()
    applyServerMessageEffects({ type: 'ready', hasApiKey: true }, deps)
    expect(deps.sent.some((m) => m.type === 'session:list')).toBe(true)
    expect(deps.resyncActiveIfRunning).toHaveBeenCalled()
  })

  it('compact:result ok appends a summary assistant message', () => {
    const deps = makeDeps()
    applyServerMessageEffects({
      type: 'compact:result',
      sessionId: 's1',
      ok: true,
      inputTokens: 1,
      outputTokens: 2,
      messagesBefore: 10,
      messagesAfter: 4,
    }, deps)
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toContain('10 messages → 4 messages')
  })

  describe('workflow messages', () => {
    it('workflow:started projects into store and auto-opens DAG tab for code surface', () => {
      const deps = makeDeps()
      applyServerMessageEffects({
        type: 'workflow:started',
        sessionId: 's1',
        runId: 'r1',
        def: mockDef,
      }, deps)

      const slice = useWorkflowStore.getState().getSession('s1')
      expect(slice.activeWorkflow).toEqual(mockDef)
      expect(slice.runId).toBe('r1')
      expect(slice.runState?.status).toBe('pending')
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.codePanelOpen).toBe(true)
      expect(useUiStore.getState().activeTab).toBe('dag')
    })

    it('workflow:started does not open DAG for chat surface', () => {
      seedSession('chat')
      useUiStore.setState({ activeTab: 'files' })
      const deps = makeDeps()
      applyServerMessageEffects({
        type: 'workflow:started',
        sessionId: 's1',
        runId: 'r1',
        def: mockDef,
      }, deps)

      expect(useWorkflowStore.getState().getSession('s1').activeWorkflow).toEqual(mockDef)
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.codePanelOpen).toBe(false)
      expect(useUiStore.getState().activeTab).toBe('files')
    })

    it('workflow:started does not switch tab when session is not active', () => {
      useDomainStore.setState({ activeSessionId: 'other' })
      useUiStore.setState({ activeTab: 'files' })
      const deps = makeDeps()
      applyServerMessageEffects({
        type: 'workflow:started',
        sessionId: 's1',
        runId: 'r1',
        def: mockDef,
      }, deps)

      expect(useWorkflowStore.getState().getSession('s1').activeWorkflow).toEqual(mockDef)
      expect(useUiStore.getState().activeTab).toBe('files')
    })

    it('workflow:event applies orchestrator event to the session slice', () => {
      useWorkflowStore.getState().setActiveWorkflow('s1', mockDef, 'r1')
      applyServerMessageEffects({
        type: 'workflow:event',
        sessionId: 's1',
        runId: 'r1',
        event: { type: 'run:started' },
      }, makeDeps())
      expect(useWorkflowStore.getState().getSession('s1').runState?.status).toBe('running')
    })

    it('workflow:snapshot replaces session slice', () => {
      const state = {
        runId: 'r2',
        workflowId: 'w1',
        status: 'succeeded' as const,
        nodes: {},
      }
      applyServerMessageEffects({
        type: 'workflow:snapshot',
        sessionId: 's1',
        runId: 'r2',
        def: mockDef,
        state,
      }, makeDeps())
      const slice = useWorkflowStore.getState().getSession('s1')
      expect(slice.activeWorkflow).toEqual(mockDef)
      expect(slice.runState).toEqual(state)
      expect(slice.runId).toBe('r2')
    })

    it('workflow:cleared removes session slice', () => {
      useWorkflowStore.getState().setActiveWorkflow('s1', mockDef, 'r1')
      applyServerMessageEffects({ type: 'workflow:cleared', sessionId: 's1' }, makeDeps())
      expect(useWorkflowStore.getState().bySession['s1']).toBeUndefined()
    })

    it('session:loaded requests workflow:getActive', () => {
      const deps = makeDeps()
      applyServerMessageEffects({
        type: 'session:loaded',
        sessionId: 's1',
        messages: [],
      }, deps)
      expect(deps.sent).toContainEqual({ type: 'workflow:getActive', sessionId: 's1' })
    })

    it('session:deleted clears workflow session slice', () => {
      useWorkflowStore.getState().setActiveWorkflow('s1', mockDef, 'r1')
      applyServerMessageEffects({ type: 'session:deleted', sessionId: 's1' }, makeDeps())
      expect(useWorkflowStore.getState().bySession['s1']).toBeUndefined()
    })
  })
})
