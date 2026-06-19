import { describe, it, expect, vi } from 'vitest'
import type { AgentRunner, AgentRunRequest } from '../orchestrator/ports.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { GraphEmit } from './graph.js'
import type { ExternalAgentHooks, PermissionChoice } from './agents/types.js'
import { createSessionAgentRunner } from './orchestrator-adapter.js'

function reqFor(agentId: string, text = 'hello'): AgentRunRequest {
  return { runId: 'run-1', nodeId: 'n1', agentId, input: { text } }
}

/** Build a mock AgentInvoker that stores the last emit + hooks so tests can inspect them. */
function mockInvoker(returnText: string, fn?: (emit: GraphEmit, hooks: ExternalAgentHooks) => void) {
  const invoke = vi.fn(async (agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks) => {
    fn?.(emit, hooks!)
    return returnText
  })
  return {
    invoke,
    reset() { invoke.mockClear() },
  }
}

/** Build a mock subagent runner. */
function mockSubagentRunner(returnText: string) {
  return vi.fn(async (_input: string, _signal: AbortSignal) => returnText)
}

describe('createSessionAgentRunner', () => {
  // ── Worker routing ──────────────────────────────────────────────
  it('① routes agentId="worker" to subagentRunner', async () => {
    const runner = mockSubagentRunner('worker output')
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke: vi.fn() }), runner)

    const out = await adapter.run(reqFor('worker', 'do the task'), new AbortController().signal)
    expect(out).toEqual({ text: 'worker output', data: undefined })
    expect(runner).toHaveBeenCalledWith('do the task', expect.any(AbortSignal))
  })

  it('① throws when worker subagentRunner not configured', async () => {
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke: vi.fn() }))
    await expect(
      adapter.run(reqFor('worker', 'x'), new AbortController().signal),
    ).rejects.toThrow('worker subagent runner not configured')
  })

  it('① passes input.data through on worker path', async () => {
    const runner = mockSubagentRunner('ok')
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke: vi.fn() }), runner)
    const out = await adapter.run(
      { runId: 'r1', nodeId: 'n1', agentId: 'worker', input: { text: 'hi', data: { key: 1 } } },
      new AbortController().signal,
    )
    expect(out.data).toEqual({ key: 1 })
  })

  // ── Invoker routing ─────────────────────────────────────────────
  it('② routes non-worker agentId to invoker.invoke()', async () => {
    const { invoke, reset } = mockInvoker('agent output')
    const factory = () => ({ invoke })
    const adapter = createSessionAgentRunner('/my/cwd', factory)

    const out = await adapter.run(reqFor('my-agent', 'solve this'), new AbortController().signal)
    expect(out).toEqual({ text: 'agent output', data: undefined })
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith(
      'my-agent',
      'solve this',
      expect.any(Object), // emit
      expect.any(AbortSignal),
      expect.any(Object), // hooks
      undefined,          // extras (no opts passed)
    )
    reset()
  })

  it('② passes extras from opts to invoker', async () => {
    const { invoke } = mockInvoker('ok')
    const factory = () => ({ invoke })
    const adapter = createSessionAgentRunner('/cwd', factory, undefined, {
      permissionMode: 'chat',
    })

    await adapter.run(reqFor('agent'), new AbortController().signal)
    expect(invoke).toHaveBeenCalledWith(
      'agent',
      expect.any(String),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Object),
      expect.objectContaining({ permissionMode: 'chat' }),
    )
  })

  it('② passes input.data through on invoker path', async () => {
    const { invoke } = mockInvoker('ok')
    const factory = () => ({ invoke })
    const adapter = createSessionAgentRunner('/cwd', factory)
    const out = await adapter.run(
      { runId: 'r1', nodeId: 'n1', agentId: 'agent', input: { text: 'hi', data: { x: 2 } } },
      new AbortController().signal,
    )
    expect(out.data).toEqual({ x: 2 })
  })

  // ── Noop emit ───────────────────────────────────────────────────
  it('③ noop emit never throws', async () => {
    let capturedEmit: GraphEmit | null = null
    const { invoke } = mockInvoker('ok', (emit) => { capturedEmit = emit })
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))

    await adapter.run(reqFor('agent'), new AbortController().signal)
    expect(capturedEmit).not.toBeNull()

    // Call every callback — none should throw.
    capturedEmit!.token('delta')
    capturedEmit!.reasoning('think')
    capturedEmit!.toolStarted('run_script', 'call-1', { command: 'ls' })
    capturedEmit!.toolFinished('call-1', 'finished', 'output')
    capturedEmit!.toolFinished('call-2', 'error', undefined, 'failed')
    capturedEmit!.usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
  })

  // ── HITL auto-rejection ─────────────────────────────────────────
  it('④ HITL requestPermission auto-rejects with { cancelled: true }', async () => {
    let capturedHooks: ExternalAgentHooks | null = null
    const { invoke } = mockInvoker('ok', (_emit, hooks) => { capturedHooks = hooks })
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))

    await adapter.run(reqFor('agent'), new AbortController().signal)
    expect(capturedHooks).not.toBeNull()

    const choice: PermissionChoice = await capturedHooks!.requestPermission({
      requestId: 'r1',
      tool: { title: 'Run ls', kind: 'execute', content: 'ls' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    })
    expect(choice).toEqual({ cancelled: true })
  })

  it('④ configOptions does not throw', async () => {
    let capturedHooks: ExternalAgentHooks | null = null
    const { invoke } = mockInvoker('ok', (_emit, hooks) => { capturedHooks = hooks })
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))

    await adapter.run(reqFor('agent'), new AbortController().signal)
    expect(() => capturedHooks!.configOptions([{ id: 'm', name: 'Model', category: 'model', currentValue: 'x', options: [{ value: 'x', name: 'X' }] }])).not.toThrow()
  })

  // ── Unknown agentId ─────────────────────────────────────────────
  it('⑤ unknown agentId throws error from invoker', async () => {
    const invoke = vi.fn(async () => { throw new Error('unknown or disabled agent: bad-id') })
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))

    await expect(adapter.run(reqFor('bad-id'), new AbortController().signal)).rejects.toThrow(
      'unknown or disabled agent: bad-id',
    )
  })

  // ── Abort signal ────────────────────────────────────────────────
  it('⑥ aborted signal before run throws AbortError', async () => {
    const { invoke } = mockInvoker('ok')
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))
    const ac = new AbortController()
    ac.abort()

    await expect(adapter.run(reqFor('agent'), ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('⑥ signal propagates to invoker', async () => {
    const { invoke } = mockInvoker('ok')
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))
    const ac = new AbortController()

    const p = adapter.run(reqFor('agent'), ac.signal)
    const text = await p
    expect(text).toEqual({ text: 'ok', data: undefined })
    expect(invoke).toHaveBeenCalledWith(
      'agent',
      'hello',
      expect.any(Object),
      ac.signal,
      expect.any(Object),
      undefined,
    )
  })

  it('⑥ invokerFactory called once (eager construction)', () => {
    const buildCount = vi.fn((_cwd: string) => ({ invoke: vi.fn() }) as AgentInvoker)
    createSessionAgentRunner('/cwd', buildCount)
    expect(buildCount).toHaveBeenCalledTimes(1)
    expect(buildCount).toHaveBeenCalledWith('/cwd')
  })

  // ── Invoker respects cwd ────────────────────────────────────────
  it('passes cwd to invokerFactory', async () => {
    const built: string[] = []
    const factory = (c: string) => {
      built.push(c)
      return { invoke: vi.fn(async () => 'ok') }
    }
    createSessionAgentRunner('/path/to/project', factory)
    expect(built).toEqual(['/path/to/project'])
  })

  // ── Edge: empty opts → extras is undefined ──────────────────────
  it('omits extras when opts is undefined', async () => {
    const { invoke } = mockInvoker('ok')
    const adapter = createSessionAgentRunner('/tmp', () => ({ invoke }))

    await adapter.run(reqFor('agent'), new AbortController().signal)
    expect(invoke).toHaveBeenCalledWith(
      'agent',
      expect.any(String),
      expect.any(Object),
      expect.any(AbortSignal),
      expect.any(Object),
      undefined,
    )
  })
})
