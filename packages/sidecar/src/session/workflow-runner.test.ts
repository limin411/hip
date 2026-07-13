import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, WorkflowDef } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { TraceRun } from './tool-trace.js'
import { NetworkPolicy } from './network-policy.js'
import { ToolOutputStore } from './tool-output-store.js'
import { GuardianReviewer } from './guardian.js'
import type { WorkflowRunDeps } from './workflow-runner.js'
import { HookRegistry } from './hooks/registry.js'

const { capturedRunSubagentArgs, runWorkflowMock } = vi.hoisted(() => ({
  capturedRunSubagentArgs: [] as Array<Record<string, unknown>>,
  runWorkflowMock: vi.fn(),
}))

vi.mock('./subagent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./subagent.js')>()
  return {
    ...actual,
    runSubagent: (args: Record<string, unknown>) => {
      capturedRunSubagentArgs.push(args)
      return Promise.resolve('mock subagent result')
    },
  }
})

vi.mock('../orchestrator/executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../orchestrator/executor.js')>()
  runWorkflowMock.mockImplementation(actual.runWorkflow)
  return {
    ...actual,
    runWorkflow: (...args: unknown[]) => runWorkflowMock(...args),
  }
})

function textRunner(text: string): ModelRunner {
  return {
    async run(_messages: BaseMessage[], _opts: ModelRunOptions): Promise<AIMessage> {
      return new AIMessage(text)
    },
  }
}

function makeDeps(overrides?: Partial<WorkflowRunDeps>): WorkflowRunDeps {
  const cwd = mkdtempSync(join(tmpdir(), 'hip-wf-'))
  return {
    id: 'wf-sess-1',
    config: { llmProvider: 'test', model: 'test', tools: [], cwd },
    modelRunner: () => textRunner('ok'),
    summarizer: () => ({ async summarize() { return '' } }),
    invokerFactory: (_cwd: string): AgentInvoker => ({
      async invoke(_agentId: string, _task: string, _emit: GraphEmit, _signal: AbortSignal) { return 'invoked' },
    }),
    store: undefined,
    idleTimeoutMs: 60_000,
    pendingPermissions: new Map(),
    hooks: new HookRegistry(),
    ...overrides,
  }
}

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('../orchestrator/executor.js')>('../orchestrator/executor.js')
  runWorkflowMock.mockReset()
  runWorkflowMock.mockImplementation(actual.runWorkflow)
})

describe('runWorkflowTurn safety-dependency wiring', () => {
  it('passes networkPolicy, toolOutputStore, guardianReviewer, and hooks to worker runSubagent calls', async () => {
    const policy = new NetworkPolicy()
    const store = new ToolOutputStore({ outputDir: join(tmpdir(), 'hip-tos-wf') })
    const guardian = new GuardianReviewer({ modelRunner: textRunner('safe') })
    const hooks = new HookRegistry()

    const deps = makeDeps({ networkPolicy: policy, toolOutputStore: store, guardianReviewer: guardian, hooks })

    const def: WorkflowDef = {
      id: 'wf-test',
      name: 'Safety Wire Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'Do the task' }],
      edges: [],
      entry: ['n1'],
    }

    const { runWorkflowTurn } = await import('./workflow-runner.js')

    const send = (_msg: ServerMessage): void => {}
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      _stopped: boolean,
    ): string => text

    capturedRunSubagentArgs.length = 0
    await runWorkflowTurn(deps, def, send, finalize)

    expect(capturedRunSubagentArgs.length).toBeGreaterThanOrEqual(1)
    const args = capturedRunSubagentArgs[0]
    expect(args.networkPolicy).toBe(policy)
    expect(args.toolOutputStore).toBe(store)
    expect(args.guardianReviewer).toBe(guardian)
    expect(args.hooks).toBe(hooks)
    expect(args.sessionId).toBe('wf-sess-1')
    // Inherits session permissionMode (default edit), never forced full.
    expect(args.permissionMode).toBe('edit')
  })
})

describe('runWorkflowTurn lifecycle hooks', () => {
  it('fires TurnStart and TurnComplete; UserPromptSubmit when runInputs.text present', async () => {
    const order: string[] = []
    const hooks = new HookRegistry()
    for (const event of ['UserPromptSubmit', 'TurnStart', 'Stop', 'TurnComplete'] as const) {
      hooks.register({
        event,
        handler: async () => {
          order.push(event)
          return { kind: 'allow' }
        },
      })
    }
    runWorkflowMock.mockImplementation(async (_def: unknown, _ports: unknown, opts: { runId: string }) => {
      return { runId: opts.runId, workflowId: 'wf-lc', status: 'succeeded' as const, nodes: {} }
    })
    const deps = makeDeps({ hooks })
    const def: WorkflowDef = {
      id: 'wf-lc',
      name: 'LC',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'x' }],
      edges: [],
      entry: ['n1'],
    }
    const { runWorkflowTurn } = await import('./workflow-runner.js')
    await runWorkflowTurn(deps, def, () => {}, (_s, _t, text) => text, { runInputs: { text: 'hello' } })
    expect(order).toEqual(['UserPromptSubmit', 'TurnStart', 'Stop', 'TurnComplete'])
  })

  it('skips UserPromptSubmit when skipUserPromptSubmit is true', async () => {
    const order: string[] = []
    const hooks = new HookRegistry()
    for (const event of ['UserPromptSubmit', 'TurnStart', 'TurnComplete'] as const) {
      hooks.register({
        event,
        handler: async () => {
          order.push(event)
          return { kind: 'allow' }
        },
      })
    }
    runWorkflowMock.mockImplementation(async (_def: unknown, _ports: unknown, opts: { runId: string }) => {
      return { runId: opts.runId, workflowId: 'wf-skip', status: 'succeeded' as const, nodes: {} }
    })
    const deps = makeDeps({ hooks })
    const def: WorkflowDef = {
      id: 'wf-skip',
      name: 'Skip',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'x' }],
      edges: [],
      entry: ['n1'],
    }
    const { runWorkflowTurn } = await import('./workflow-runner.js')
    await runWorkflowTurn(deps, def, () => {}, (_s, _t, text) => text, {
      runInputs: { text: 'hello' },
      skipUserPromptSubmit: true,
    })
    expect(order).toEqual(['TurnStart', 'TurnComplete'])
  })

  it('denies turn when TurnStart returns deny', async () => {
    const hooks = new HookRegistry()
    hooks.register({
      event: 'TurnStart',
      handler: async () => ({ kind: 'deny', reason: 'nope' }),
    })
    const deps = makeDeps({ hooks })
    const def: WorkflowDef = {
      id: 'wf-deny',
      name: 'Deny',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'x' }],
      edges: [],
      entry: ['n1'],
    }
    const { runWorkflowTurn } = await import('./workflow-runner.js')
    const sent: ServerMessage[] = []
    const result = await runWorkflowTurn(deps, def, (m) => sent.push(m), (_s, _t, text) => text)
    expect(result).toBe('')
    expect(sent.some((m) => m.type === 'error' && (m as { code?: string }).code === 'HOOK_DENIED')).toBe(true)
    expect(runWorkflowMock).not.toHaveBeenCalled()
  })
})

describe('runWorkflowTurn C-validate tool/human reject', () => {
  it('tool def → INVALID_WORKFLOW error, no workflow:started, does not call runWorkflow', async () => {
    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-tool',
      name: 'Tool Reject',
      nodes: [
        { id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'x' },
        { id: 't1', type: 'tool', toolName: 'bash', inputTemplate: 'ls' },
      ],
      edges: [{ from: 'n1', to: 't1' }],
      entry: ['n1'],
    }
    const { runWorkflowTurn } = await import('./workflow-runner.js')
    const sent: ServerMessage[] = []
    const result = await runWorkflowTurn(deps, def, (m) => sent.push(m), (_s, _t, text) => text)

    expect(runWorkflowMock).not.toHaveBeenCalled()
    expect(sent.some((m) => m.type === 'workflow:started')).toBe(false)
    const err = sent.find((m) => m.type === 'error') as { type: 'error'; code?: string; message?: string } | undefined
    expect(err?.code).toBe('INVALID_WORKFLOW')
    expect(err?.message).toMatch(/tool/)
    expect(result).toMatch(/invalid workflow/i)
  })

  it('human def → INVALID_WORKFLOW error, no workflow:started', async () => {
    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-human',
      name: 'Human Reject',
      nodes: [
        { id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'x' },
        { id: 'h1', type: 'human', question: 'ok?' },
      ],
      edges: [{ from: 'n1', to: 'h1' }],
      entry: ['n1'],
    }
    const { runWorkflowTurn } = await import('./workflow-runner.js')
    const sent: ServerMessage[] = []
    const result = await runWorkflowTurn(deps, def, (m) => sent.push(m), (_s, _t, text) => text)

    expect(runWorkflowMock).not.toHaveBeenCalled()
    expect(sent.some((m) => m.type === 'workflow:started')).toBe(false)
    const err = sent.find((m) => m.type === 'error') as { type: 'error'; code?: string; message?: string } | undefined
    expect(err?.code).toBe('INVALID_WORKFLOW')
    expect(err?.message).toMatch(/human/)
    expect(result).toMatch(/invalid workflow/i)
  })
})

describe('runWorkflowTurn runInputs', () => {
  it('forwards opts.runInputs to runWorkflow', async () => {
    runWorkflowMock.mockImplementation(async (_def: unknown, _ports: unknown, opts: { runId: string; runInputs?: { text: string } }) => {
      return { runId: opts.runId, workflowId: 'wf-test', status: 'succeeded' as const, nodes: {} }
    })

    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-test',
      name: 'RunInputs Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: '{{input}}' }],
      edges: [],
      entry: ['n1'],
    }

    const { runWorkflowTurn } = await import('./workflow-runner.js')

    const send = (_msg: ServerMessage): void => {}
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      _stopped: boolean,
    ): string => text

    runWorkflowMock.mockClear()
    await runWorkflowTurn(deps, def, send, finalize, { runInputs: { text: 'hello world' } })

    expect(runWorkflowMock).toHaveBeenCalled()
    const opts = runWorkflowMock.mock.calls[0][2] as { runInputs?: { text: string } }
    expect(opts.runInputs?.text).toBe('hello world')
  })
})

describe('runWorkflowTurn workflow UI events', () => {
  it('emits workflow:started, workflow:event, and workflow:snapshot', async () => {
    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-ui-events',
      name: 'UI Events Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'Do the task' }],
      edges: [],
      entry: ['n1'],
    }

    const { runWorkflowTurn } = await import('./workflow-runner.js')

    const sent: ServerMessage[] = []
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      _stopped: boolean,
    ): string => text

    await runWorkflowTurn(deps, def, (m) => sent.push(m), finalize, { runInputs: { text: 'hi' } })

    expect(sent.some((m) => m.type === 'workflow:started')).toBe(true)
    expect(sent.some((m) => m.type === 'workflow:event')).toBe(true)
    expect(sent.some((m) => m.type === 'workflow:snapshot')).toBe(true)

    const started = sent.find((m) => m.type === 'workflow:started') as Extract<ServerMessage, { type: 'workflow:started' }>
    expect(started.def.id).toBe('wf-ui-events')
    expect(started.sessionId).toBe(deps.id)

    const snapshot = sent.find((m) => m.type === 'workflow:snapshot') as Extract<ServerMessage, { type: 'workflow:snapshot' }>
    expect(snapshot.def.id).toBe('wf-ui-events')
    expect(snapshot.runId).toBe(started.runId)

    const events = sent.filter((m) => m.type === 'workflow:event') as Array<Extract<ServerMessage, { type: 'workflow:event' }>>
    expect(events.every((m) => m.runId === started.runId)).toBe(true)
  })

  it('emits agent:started/finished for supervisor during the workflow turn', async () => {
    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-supervisor-agent',
      name: 'Supervisor Agent Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'Do the task' }],
      edges: [],
      entry: ['n1'],
    }

    const { runWorkflowTurn } = await import('./workflow-runner.js')
    const sent: ServerMessage[] = []
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      _stopped: boolean,
    ): string => text

    await runWorkflowTurn(deps, def, (m) => sent.push(m), finalize)

    const started = sent.filter((m) => m.type === 'agent:started') as Array<Extract<ServerMessage, { type: 'agent:started' }>>
    const finished = sent.filter((m) => m.type === 'agent:finished') as Array<Extract<ServerMessage, { type: 'agent:finished' }>>
    expect(started.some((m) => m.agentId === 'supervisor' && m.role === 'supervisor')).toBe(true)
    expect(finished.some((m) => m.agentId === 'supervisor')).toBe(true)
  })
})

describe('runWorkflowTurn external abort signal', () => {
  it('links opts.signal so aborting the external controller aborts the executor signal', async () => {
    let executorSignal: AbortSignal | undefined
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    runWorkflowMock.mockImplementation(async (_def: unknown, _ports: unknown, opts: { runId: string; signal?: AbortSignal }) => {
      executorSignal = opts.signal
      await gate
      if (opts.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      }
      return { runId: opts.runId, workflowId: 'wf-abort', status: 'succeeded' as const, nodes: {} }
    })

    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-abort',
      name: 'Abort Wire Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'Do the task' }],
      edges: [],
      entry: ['n1'],
    }

    const { runWorkflowTurn } = await import('./workflow-runner.js')
    const external = new AbortController()
    const sent: ServerMessage[] = []
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      _stopped: boolean,
    ): string => text

    const p = runWorkflowTurn(deps, def, (m) => sent.push(m), finalize, { signal: external.signal })
    // Wait until runWorkflow has been entered and captured the signal.
    await vi.waitFor(() => {
      expect(executorSignal).toBeDefined()
    })
    expect(executorSignal!.aborted).toBe(false)

    external.abort()
    expect(executorSignal!.aborted).toBe(true)

    release()
    const result = await p
    // Cancel still finalizes a stopped partial (at least a cancel note).
    expect(result).toContain('cancelled')
    expect(sent.some((m) => m.type === 'error' && (m as { code?: string }).code === 'CANCELLED')).toBe(true)
  })

  it('immediately aborts when opts.signal is already aborted', async () => {
    runWorkflowMock.mockImplementation(async (_def: unknown, _ports: unknown, opts: { runId: string; signal?: AbortSignal }) => {
      if (opts.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        throw err
      }
      return { runId: opts.runId, workflowId: 'wf-pre-abort', status: 'succeeded' as const, nodes: {} }
    })

    const deps = makeDeps()
    const def: WorkflowDef = {
      id: 'wf-pre-abort',
      name: 'Pre-abort Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'Do the task' }],
      edges: [],
      entry: ['n1'],
    }

    const { runWorkflowTurn } = await import('./workflow-runner.js')
    const external = new AbortController()
    external.abort()
    const sent: ServerMessage[] = []
    let finalizeStopped: boolean | undefined
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      stopped: boolean,
    ): string => {
      finalizeStopped = stopped
      return text
    }

    const result = await runWorkflowTurn(deps, def, (m) => sent.push(m), finalize, { signal: external.signal })
    expect(result).toContain('cancelled')
    expect(finalizeStopped).toBe(true)
    expect(sent.some((m) => m.type === 'error' && (m as { code?: string }).code === 'CANCELLED')).toBe(true)
  })
})
