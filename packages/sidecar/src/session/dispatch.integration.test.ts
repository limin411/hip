import { describe, it, expect, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { makeToolCallingModel, registerAgent, makeSession, collect, cleanupAgents, type StubInvoke } from './__testutils__/dispatch-harness.js'

afterEach(() => cleanupAgents())

describe('dispatch_agent end-to-end (nested sub-agent)', () => {
  it('runs the sub-agent as role=subagent under the supervisor and returns its text', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'do it' }, 'all done')
    const session = makeSession('s-dispatch', model, async (_id, _task, emit) => { emit.token('patched'); return 'patched' })

    const events = await collect(session, 'please delegate')
    const sub = events.find((e): e is Extract<ServerMessage, { type: 'agent:started' }> => e.type === 'agent:started' && e.role === 'subagent')
    expect(sub?.parentAgentId).toBe('supervisor')
    expect(events.some((e) => e.type === 'token:stream' && e.agentId === sub?.agentId)).toBe(true)
    expect(events.some((e) => e.type === 'tool:finished')).toBe(true)
  })

  it('cancelling during a dispatched sub-agent ends the turn as CANCELLED (no supervisor resume)', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'do it' }, 'all done')
    // Sub-agent blocks until aborted, then throws AbortError like a real provider.
    const stub: StubInvoke = (_id, _task, _emit, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { const e = new Error('Aborted'); e.name = 'AbortError'; reject(e) }, { once: true })
      })
    const session = makeSession('s-abort', model, stub)
    const events = await collect(session, 'go', (m) => {
      if (m.type === 'agent:started' && m.role === 'subagent') session.cancel()
    })
    const err = events.find((e): e is Extract<ServerMessage, { type: 'error' }> => e.type === 'error')
    expect(err?.code).toBe('CANCELLED')
    // The supervisor must NOT have resumed to emit its final text.
    expect(events.some((e) => e.type === 'token:stream' && e.delta === 'all done')).toBe(false)
  })

  it('dispatch_agent propagates abort signal through DispatchSpec — cancel reaches invoker', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'do it' }, 'all done')
    // Stub that blocks until aborted — verifies the signal reaches the invoker.
    let receivedSignal: AbortSignal | undefined
    const stub: StubInvoke = (_id, _task, _emit, signal) =>
      new Promise<string>((resolve, reject) => {
        receivedSignal = signal
        signal.addEventListener('abort', () => { const e = new Error('Cancelled'); e.name = 'AbortError'; reject(e) }, { once: true })
      })
    const session = makeSession('s-dispatch-sig', model, stub)
    const events = await collect(session, 'delegate and abort', (m) => {
      if (m.type === 'agent:started' && m.role === 'subagent') session.cancel()
    })
    // Verify the invoker received a real AbortSignal and the turn ended as CANCELLED.
    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal!.aborted).toBe(true)
    const err = events.find((e): e is Extract<ServerMessage, { type: 'error' }> => e.type === 'error')
    expect(err?.code).toBe('CANCELLED')
    // Supervisor must NOT have resumed.
    expect(events.some((e) => e.type === 'token:stream' && e.delta === 'all done')).toBe(false)
  })

  it('message:complete preserves the dispatched sub-agent run and timeline', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'do it' }, 'all done')
    const session = makeSession('s-complete', model, async (_id, _task, emit) => {
      emit.reasoning('thinking')
      emit.toolStarted('read_file', 'c1', { path: '/x' })
      emit.toolFinished('c1', 'finished', 'file contents')
      emit.token('patched')
      return 'patched'
    })

    const events = await collect(session, 'please delegate')
    const complete = events.find((e): e is Extract<ServerMessage, { type: 'message:complete' }> => e.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(complete!.message.agentRuns?.some((r) => r.role === 'subagent' && r.parentAgentId === 'supervisor')).toBe(true)
    expect(complete!.message.timeline?.some((t) => t.kind === 'reasoning')).toBe(true)
    expect(complete!.message.timeline?.some((t) => t.kind === 'tool' && t.callId === 'c1')).toBe(true)
    expect(complete!.message.toolCalls?.some((t) => t.callId === 'c1')).toBe(true)
  })
})
