import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useDomainStore } from './sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { useWorkflowStore } from '@/store/workflowStore'
import { useUiStore } from '@/store/uiStore'
import { useFocusStore } from '@/store/focusStore'
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
    useFocusStore.setState({
      autoFollowEdits: true,
      followPaused: false,
      panelDismissedThisTurn: false,
      deferredWriteFollow: null,
      focusedPath: null,
      focusedCallId: null,
    })
  })

  it('ready resets diff transient and requests session:list + trash:list', () => {
    const deps = makeDeps()
    applyServerMessageEffects({ type: 'ready', hasApiKey: true }, deps)
    expect(deps.sent.some((m) => m.type === 'session:list')).toBe(true)
    expect(deps.sent.some((m) => m.type === 'session:trash:list')).toBe(true)
    expect(deps.resyncActiveIfRunning).toHaveBeenCalled()
  })

  it('AGENT_BUSY toasts agent-switch busy; plain BUSY does not', () => {
    const deps = makeDeps()
    toastError.mockClear()
    applyServerMessageEffects(
      { type: 'error', sessionId: 's1', code: 'AGENT_BUSY', message: 'Cannot change agent while a turn is running' },
      deps,
    )
    expect(toastError).toHaveBeenCalled()
    toastError.mockClear()
    applyServerMessageEffects(
      { type: 'error', sessionId: 's1', code: 'BUSY', message: 'A turn is already running' },
      deps,
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('KD-16: plan:respond:result ok:false toasts respondFailed', () => {
    const deps = makeDeps()
    toastError.mockClear()
    applyServerMessageEffects(
      {
        type: 'plan:respond:result',
        sessionId: 's1',
        ok: false,
        action: 'approve',
        reason: 'not_awaiting',
      },
      deps,
    )
    expect(toastError).toHaveBeenCalled()
    toastError.mockClear()
    applyServerMessageEffects(
      { type: 'plan:respond:result', sessionId: 's1', ok: true, action: 'approve' },
      deps,
    )
    expect(toastError).not.toHaveBeenCalled()
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

    it('workflow:started projects into store without switching tabs (Agents tab removed)', () => {
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
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.codePanelOpen).toBe(false)
      expect(useUiStore.getState().activeTab).toBe('files')
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
    function finishWrite(path: string, callId = 'c1') {
      useDomainStore.setState((st) => ({
        sessions: st.sessions.map((s) =>
          s.id === 's1'
            ? {
                ...s,
                messages: [
                  {
                    id: 't1',
                    role: 'assistant' as const,
                    content: '',
                    timestamp: 1,
                    toolCalls: [
                      {
                        callId,
                        agentId: 'supervisor',
                        name: 'write_file',
                        input: JSON.stringify({ path, content: 'x' }),
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
          turnId: 't1',
          agentId: 'supervisor',
          callId,
          status: 'finished',
          output: `wrote ${path} (1 bytes)`,
        },
        makeDeps(),
      )
    }

    it('tool:finished mid-turn does not force-open chat panel for durable products', () => {
      seedSession('chat')
      useUiStore.setState({ activeView: 'chat', selectedArtifactPath: null })
      finishWrite('/page.html')
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
    })

    it('tool:finished mid-turn does not force-open for source or scripts', () => {
      seedSession('chat')
      finishWrite('/src/a.ts')
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
      seedSession('chat')
      finishWrite('/scripts/check.py')
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
      expect(useFocusStore.getState().deferredWriteFollow?.path).toBe('/scripts/check.py')
    })

    it('message:complete on chat surface opens PreviewPanel for the latest durable deliverable', () => {
      seedSession('chat')
      useUiStore.setState({
        activeView: 'chat',
        chatActiveTab: 'files',
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

    it('message:complete on chat surface opens Sources when the turn used web search (no file product)', () => {
      seedSession('chat')
      useUiStore.setState({
        activeView: 'chat',
        chatActiveTab: 'files',
        selectedArtifactPath: null,
      })
      applyServerMessageEffects(
        {
          type: 'message:complete',
          sessionId: 's1',
          message: {
            id: 't1',
            role: 'assistant',
            content: 'found it',
            timestamp: 1,
            toolCalls: [
              {
                callId: 'ws1',
                agentId: 'supervisor',
                name: 'web_search',
                input: JSON.stringify({ query: 'hip desktop agent' }),
                status: 'finished',
                seq: 0,
                output: 'Title: hip\nURL: https://example.com/hip\n\n---\n\nTitle: Docs\nURL: https://example.com/docs',
              },
            ],
          },
        },
        makeDeps(),
      )
      const sess = useDomainStore.getState().sessions.find((s) => s.id === 's1')!
      expect(sess.chatPanelOpen).toBe(true)
      expect(useUiStore.getState().chatActiveTab).toBe('sources')
    })

    it('message:complete prefers durable files over Sources when both exist', () => {
      seedSession('chat')
      useUiStore.setState({ activeView: 'chat', chatActiveTab: 'files' })
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
                callId: 'ws1',
                agentId: 'supervisor',
                name: 'web_search',
                input: JSON.stringify({ query: 'x' }),
                status: 'finished',
                seq: 0,
                output: 'Title: A\nURL: https://a.example/',
              },
              {
                callId: 'c1',
                agentId: 'supervisor',
                name: 'write_file',
                input: JSON.stringify({ path: '/report.md', content: '# hi' }),
                status: 'finished',
                seq: 1,
                output: 'wrote /report.md (4 bytes)',
              },
            ],
          },
        },
        makeDeps(),
      )
      expect(useUiStore.getState().chatActiveTab).toBe('files')
      expect(useUiStore.getState().selectedArtifactPath).toBe('/report.md')
    })

    it('message:complete does not open for draft/wip/ephemeral renderables or source-only turns', () => {
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
            content: 'done',
            timestamp: 1,
            toolCalls: [
              {
                callId: 'c1',
                agentId: 'supervisor',
                name: 'write_file',
                input: JSON.stringify({ path: '/notes_draft.md', content: 'wip' }),
                status: 'finished',
                seq: 0,
                output: 'wrote /notes_draft.md (3 bytes)',
              },
              {
                callId: 'c2',
                agentId: 'supervisor',
                name: 'write_file',
                input: JSON.stringify({ path: '/src/a.ts', content: 'export {}' }),
                status: 'finished',
                seq: 1,
                output: 'wrote /src/a.ts (10 bytes)',
              },
            ],
          },
        },
        deps,
      )
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
    })

    it('message:complete does not open when only a script was written', () => {
      seedSession('chat')
      useFocusStore.setState({
        deferredWriteFollow: { sessionId: 's1', path: '/scripts/check.py', callId: 'c-py' },
      })
      const deps = makeDeps()
      applyServerMessageEffects(
        {
          type: 'message:complete',
          sessionId: 's1',
          message: {
            id: 't1',
            role: 'assistant',
            content: 'ran check',
            timestamp: 1,
            toolCalls: [
              {
                callId: 'c-py',
                agentId: 'supervisor',
                name: 'write_file',
                input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
                status: 'finished',
                seq: 0,
                output: 'wrote /scripts/check.py (8 bytes)',
              },
            ],
          },
        },
        deps,
      )
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
      expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
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

    it('message:complete on chat surface does not open panel when user dismissed this turn', () => {
      seedSession('chat')
      useFocusStore.setState({ panelDismissedThisTurn: true })
      useUiStore.setState({
        activeView: 'chat',
        chatActiveTab: 'files',
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
      expect(useDomainStore.getState().sessions.find((s) => s.id === 's1')!.chatPanelOpen).toBe(false)
    })
  })
})