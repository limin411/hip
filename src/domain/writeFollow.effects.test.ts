import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useDomainStore } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useFocusStore } from '@/store/focusStore'
import { useUiStore } from '@/store/uiStore'

function seedCodeSession(toolCalls: Array<{
  callId: string
  name: string
  input: string
  status?: string
  seq?: number
}>) {
  useDomainStore.setState({
    sessions: [
      {
        id: 's1',
        config: { llmProvider: 'deepseek', model: 'x', tools: [], surface: 'code', cwd: '/tmp/p' },
        title: 't',
        preview: '',
        updatedAtMs: 0,
        loaded: true,
        messages: [
          {
            id: 't1',
            role: 'assistant',
            content: '',
            timestamp: 1,
            toolCalls: toolCalls.map((tc, i) => ({
              callId: tc.callId,
              agentId: 'coder',
              name: tc.name,
              input: tc.input,
              status: (tc.status ?? 'running') as 'running',
              seq: tc.seq ?? i + 1,
            })),
          },
        ],
        status: 'running',
        error: null,
        codePanelOpen: false,
        chatPanelOpen: false,
      },
    ],
    activeSessionId: 's1',
  } as never)
}

function makeDeps(): ServerMessageEffectDeps & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
    requestDiff: vi.fn(),
    requestCheckpoints: vi.fn(),
    requestCommitLog: vi.fn(),
    resyncActiveIfRunning: vi.fn(),
  }
}

function finishTool(callId: string, deps: ServerMessageEffectDeps) {
  applyServerMessageEffects(
    {
      type: 'tool:finished',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'coder',
      callId,
      status: 'finished',
      output: 'ok',
    },
    deps,
  )
}

function completeMessage(deps: ServerMessageEffectDeps, toolCalls: Array<{
  callId: string
  name: string
  input: string
  status?: string
  seq?: number
  output?: string
}>) {
  applyServerMessageEffects(
    {
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 't1',
        role: 'assistant',
        content: 'done',
        timestamp: 2,
        toolCalls: toolCalls.map((tc, i) => ({
          callId: tc.callId,
          agentId: 'coder',
          name: tc.name,
          input: tc.input,
          status: (tc.status ?? 'finished') as 'finished',
          seq: tc.seq ?? i,
          output: tc.output,
        })),
      },
    },
    deps,
  )
}

describe('write-follow effects (P1 C1)', () => {
  beforeEach(() => {
    seedCodeSession([
      {
        callId: 'c1',
        name: 'write_file',
        input: JSON.stringify({ path: '/README.md', content: 'hi' }),
      },
    ])
    useFsStore.setState({ bySession: {} } as never)
    useUiStore.setState({ activeTab: 'files', activeView: 'code' })
    useFocusStore.setState({
      autoFollowEdits: true,
      followPaused: false,
      panelDismissedThisTurn: false,
      deferredWriteFollow: null,
      focusedPath: null,
      focusedCallId: null,
    })
  })

  it('sets preview path on durable write tool:finished without force-opening code panel', () => {
    const deps = makeDeps()
    finishTool('c1', deps)
    const prev = useFsStore.getState().bySession['s1']?.preview
    expect(prev && prev.status !== 'idle' ? prev.path : undefined).toBe('/README.md')
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'fs:read', path: '/README.md' }))
    expect(useFocusStore.getState().focusedPath).toBe('/README.md')
    // Code surface: keep conversation full-width; user opens panel explicitly.
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
  })

  it('follows into Files tab when code panel is already open on durable write', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === 's1' ? { ...sess, codePanelOpen: true } : sess,
      ),
    }))
    useUiStore.setState({ activeTab: 'files' })
    const deps = makeDeps()
    finishTool('c1', deps)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
    expect(useUiStore.getState().activeTab).toBe('files')
    expect(useFocusStore.getState().focusedPath).toBe('/README.md')
  })

  it('skips follow when paused', () => {
    useFocusStore.setState({ followPaused: true })
    const deps = makeDeps()
    finishTool('c1', deps)
    const prev = useFsStore.getState().bySession['s1']?.preview
    expect(prev && prev.status !== 'idle' ? prev.path : undefined).toBeUndefined()
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
  })

  it('skips follow when user dismissed the panel this turn', () => {
    useFocusStore.setState({ panelDismissedThisTurn: true })
    const deps = makeDeps()
    finishTool('c1', deps)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
  })

  it('does not open panel for ephemeral script paths', () => {
    seedCodeSession([
      {
        callId: 'c-tmp',
        name: 'write_file',
        input: JSON.stringify({ path: '/tmp/oneoff.py', content: 'print(1)' }),
      },
    ])
    const deps = makeDeps()
    finishTool('c-tmp', deps)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
    const prev = useFsStore.getState().bySession['s1']?.preview
    expect(prev && prev.status !== 'idle' ? prev.path : undefined).toBeUndefined()
  })

  it('defers preview follow for script-like paths until turn end without force-opening panel', () => {
    seedCodeSession([
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
      },
    ])
    const deps = makeDeps()
    finishTool('c-py', deps)
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
    expect(useFocusStore.getState().deferredWriteFollow).toEqual({
      sessionId: 's1',
      path: '/scripts/check.py',
      callId: 'c-py',
    })

    completeMessage(deps, [
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
        status: 'finished',
      },
    ])
    // Still never force-open on code; preview/focus update for when user opens panel.
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
    expect(useFocusStore.getState().focusedPath).toBe('/scripts/check.py')
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
  })

  it('cancels deferred open when run_script executes the written script', () => {
    seedCodeSession([
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
      },
      {
        callId: 'c-run',
        name: 'run_script',
        input: JSON.stringify({ command: 'python /scripts/check.py' }),
      },
    ])
    const deps = makeDeps()
    finishTool('c-py', deps)
    expect(useFocusStore.getState().deferredWriteFollow?.path).toBe('/scripts/check.py')

    finishTool('c-run', deps)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()

    completeMessage(deps, [
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
        status: 'finished',
      },
      {
        callId: 'c-run',
        name: 'run_script',
        input: JSON.stringify({ command: 'python /scripts/check.py' }),
        status: 'finished',
        output: 'exit_code=0',
      },
    ])
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
  })

  it('cancels deferred open when run_script uses basename only', () => {
    seedCodeSession([
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
      },
      {
        callId: 'c-run',
        name: 'run_script',
        input: JSON.stringify({ command: 'python check.py' }),
      },
    ])
    const deps = makeDeps()
    finishTool('c-py', deps)
    finishTool('c-run', deps)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
  })

  it('still follows script write when panel is already open', () => {
    seedCodeSession([
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
      },
    ])
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === 's1' ? { ...sess, codePanelOpen: true } : sess,
      ),
    }))
    const deps = makeDeps()
    finishTool('c-py', deps)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
    expect(useFocusStore.getState().focusedPath).toBe('/scripts/check.py')
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fs:read', path: '/scripts/check.py' }),
    )
  })

  it('keeps Changes tab when already reviewing diffs on durable write', () => {
    useDomainStore.setState((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === 's1' ? { ...sess, codePanelOpen: true } : sess,
      ),
    }))
    useUiStore.setState({ activeTab: 'changes' })
    const deps = makeDeps()
    finishTool('c1', deps)
    expect(useUiStore.getState().activeTab).toBe('changes')
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(true)
  })

  it('immediate durable write clears any deferred script follow without force-opening panel', () => {
    seedCodeSession([
      {
        callId: 'c-py',
        name: 'write_file',
        input: JSON.stringify({ path: '/scripts/check.py', content: 'print(1)' }),
      },
      {
        callId: 'c-ts',
        name: 'write_file',
        input: JSON.stringify({ path: '/src/a.ts', content: 'export {}' }),
      },
    ])
    const deps = makeDeps()
    finishTool('c-py', deps)
    expect(useFocusStore.getState().deferredWriteFollow?.path).toBe('/scripts/check.py')
    finishTool('c-ts', deps)
    expect(useFocusStore.getState().deferredWriteFollow).toBeNull()
    expect(useDomainStore.getState().sessions[0].codePanelOpen).toBe(false)
    expect(useFocusStore.getState().focusedPath).toBe('/src/a.ts')
  })
})
