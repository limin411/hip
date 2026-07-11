import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useDomainStore } from './sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useUiStore } from '@/store/uiStore'
import type { WorkflowDef } from '@hip/protocol'
import '@/i18n'

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastMessage = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    message: (...a: unknown[]) => toastMessage(...a),
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
  Toaster: () => null,
}))

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

  it('compact:result applied appends counts and optional summary', () => {
    const deps = makeDeps()
    applyServerMessageEffects({
      type: 'compact:result',
      sessionId: 's1',
      ok: true,
      applied: true,
      tokensBefore: 100,
      tokensAfter: 40,
      messagesBefore: 10,
      messagesAfter: 4,
      summary: '[对话摘要] done',
    }, deps)
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toContain('10')
    expect(msgs[0].content).toContain('4')
    expect(msgs[0].content).toContain('[对话摘要] done')
  })

  it('compact:result noop does not claim success as compacted', () => {
    const deps = makeDeps()
    applyServerMessageEffects({
      type: 'compact:result',
      sessionId: 's1',
      ok: true,
      applied: false,
      reason: 'nothing_to_compact',
      tokensBefore: 7,
      tokensAfter: 7,
      messagesBefore: 7,
      messagesAfter: 7,
    }, deps)
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content.toLowerCase()).toContain('nothing to compact')
    expect(msgs[0].content).not.toMatch(/compacted:\s*7/i)
  })

  it('fs:gitInit:result ok toasts success and refreshes diff', () => {
    toastSuccess.mockClear()
    const deps = makeDeps()
    applyServerMessageEffects(
      { type: 'fs:gitInit:result', sessionId: 's1', ok: true },
      deps,
    )
    expect(toastSuccess).toHaveBeenCalled()
    expect(deps.requestDiff).toHaveBeenCalledWith('s1')
    expect(deps.requestCheckpoints).toHaveBeenCalledWith('s1')
  })

  it('fs:gitInit:result failure toasts error', () => {
    toastError.mockClear()
    const deps = makeDeps()
    applyServerMessageEffects(
      { type: 'fs:gitInit:result', sessionId: 's1', ok: false, error: 'no_workspace' },
      deps,
    )
    expect(toastError).toHaveBeenCalled()
  })

  it('fs:diff:result toasts empty when user-triggered and no files', async () => {
    toastMessage.mockClear()
    const { markUserDiffRequest } = await import('@/domain/commands/diffFeedback')
    markUserDiffRequest('s1')
    const deps = makeDeps()
    applyServerMessageEffects(
      {
        type: 'fs:diff:result',
        sessionId: 's1',
        state: 'ok',
        files: [],
        base: 'head',
        hasSessionStart: false,
      },
      deps,
    )
    expect(toastMessage).toHaveBeenCalled()
  })

  describe('workflow messages', () => {
    it('tool:finished write_file schedules debounced diff refresh', () => {
      vi.useFakeTimers()
      useUiStore.setState({ activeView: 'code', activeTab: 'files' })
      const deps = makeDeps()
      useDomainStore.setState((st) => ({
        ...st,
        sessions: st.sessions.map((s) =>
          s.id === 's1'
            ? {
                ...s,
                messages: [
                  {
                    id: 'turn-1',
                    role: 'assistant' as const,
                    content: '',
                    timestamp: 1,
                    toolCalls: [
                      {
                        callId: 'c1',
                        agentId: 'supervisor',
                        name: 'write_file',
                        input: '{}',
                        status: 'running' as const,
                        seq: 0,
                      },
                    ],
                  },
                ],
              }
            : s,
        ),
      }))
      applyServerMessageEffects(
        {
          type: 'tool:finished',
          sessionId: 's1',
          turnId: 'turn-1',
          agentId: 'supervisor',
          callId: 'c1',
          status: 'finished',
          output: 'ok',
        },
        deps,
      )
      expect(deps.requestDiff).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(deps.requestDiff).toHaveBeenCalledWith('s1')
      vi.useRealTimers()
    })

    it('workflow:started projects into store and focuses Agents tab for code surface', () => {
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
      expect(useUiStore.getState().activeTab).toBe('agents')
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

    it('session:loaded does not request workflow:getActive (product path has no workflow UI)', () => {
      const deps = makeDeps()
      applyServerMessageEffects({
        type: 'session:loaded',
        sessionId: 's1',
        messages: [],
      }, deps)
      expect(deps.sent.some((m) => m.type === 'workflow:getActive')).toBe(false)
    })

    it('session:deleted clears workflow session slice', () => {
      useWorkflowStore.getState().setActiveWorkflow('s1', mockDef, 'r1')
      applyServerMessageEffects({ type: 'session:deleted', sessionId: 's1' }, makeDeps())
      expect(useWorkflowStore.getState().bySession['s1']).toBeUndefined()
    })
  })

  describe('chat artifact auto-open', () => {
    it('message:complete on chat surface opens PreviewPanel and loads the latest renderable write', () => {
      seedSession('chat')
      useUiStore.setState({
        activeView: 'chat',
        chatActiveTab: 'agents',
        selectedArtifactPath: null,
      })
      const deps = makeDeps()
      applyServerMessageEffects(
        {
          type: 'message:complete',
          sessionId: 's1',
          message: {
            id: 't1',
            role: 'assistant',
            content: 'done',
            timestamp: 1,
            toolCalls: [
              {
                callId: 'c1',
                agentId: 'supervisor',
                name: 'write_file',
                input: JSON.stringify({ path: '/page.html', content: '<h1>hi</h1>' }),
                status: 'finished',
                seq: 0,
                output: 'wrote /page.html (11 bytes)',
              },
            ],
          },
        },
        deps,
      )
      const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
      expect(sess.chatPanelOpen).toBe(true)
      expect(useUiStore.getState().chatActiveTab).toBe('files')
      expect(useUiStore.getState().selectedArtifactPath).toBe('/page.html')
      expect(deps.sent.some((m) => m.type === 'fs:read' && (m as { path?: string }).path === '/page.html')).toBe(true)
    })

    it('message:complete on chat surface does not open panel when no renderable writes', () => {
      seedSession('chat')
      useUiStore.setState({ activeView: 'chat', selectedArtifactPath: null })
      const deps = makeDeps()
      applyServerMessageEffects(
        {
          type: 'message:complete',
          sessionId: 's1',
          message: {
            id: 't1',
            role: 'assistant',
            content: 'hello',
            timestamp: 1,
            toolCalls: [],
          },
        },
        deps,
      )
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
    })
  })
})
