import { describe, it, expect, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { makeToolCallingModel, registerAgent, makeSession, collect, cleanupAgents, type StubInvoke } from './__testutils__/dispatch-harness.js'

afterEach(() => cleanupAgents())

describe('nested HITL through dispatch_agent', () => {
  it('emits permission:request with an agentFrame and resumes when approved', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'edit' }, 'done')
    const stub: StubInvoke = async (_id, _task, emit, _signal, hooks) => {
      const choice = await hooks!.requestPermission({
        requestId: 'perm-1',
        tool: { title: 'edit', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      if ('optionId' in choice) emit.token('approved')
      return 'optionId' in choice ? 'approved' : 'cancelled'
    }
    const session = makeSession('s-hitl', model, stub)
    const events = await collect(session, 'go', (m) => {
      if (m.type === 'permission:request') session.respondPermission(m.requestId, { optionId: 'allow' })
    })
    const perm = events.find((e): e is Extract<ServerMessage, { type: 'permission:request' }> => e.type === 'permission:request')
    expect(perm?.agentFrame).toEqual({ agentId: 'subagent-1', parentAgentId: 'supervisor', name: 'Echo' })
    // resume actually continued the sub-agent's turn (it emitted "approved" after the choice resolved)
    expect(events.some((e) => e.type === 'token:stream' && e.delta === 'approved')).toBe(true)
  })

  it('returns a failed delegation when the user rejects', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'edit' }, 'done')
    const stub: StubInvoke = async (_id, _task, _emit, _signal, hooks) => {
      const choice = await hooks!.requestPermission({
        requestId: 'perm-2', tool: { title: 'edit', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      if ('cancelled' in choice) throw new Error('permission denied')
      return 'ok'
    }
    const session = makeSession('s-reject', model, stub)
    const events = await collect(session, 'go', (m) => {
      if (m.type === 'permission:request') session.respondPermission(m.requestId, { cancelled: true })
    })
    // dispatch_agent's catch returns "Error: permission denied" as the tool result; the turn still completes.
    expect(events.some((e) => e.type === 'tool:finished' && e.output?.includes('permission denied'))).toBe(true)
  })

  it('drains a blocked sub-agent permission on cancel() (no leak)', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'edit' }, 'done')
    // Resolve deterministically when the stub receives its choice — the runTurn `finally` drains the
    // pending permission slightly after the `error` event that ends `collect`, so reading a plain
    // variable would race.
    let settleChoice!: (c: unknown) => void
    const choiceReceived = new Promise<unknown>((r) => { settleChoice = r })
    const stub: StubInvoke = async (_id, _task, _emit, _signal, hooks) => {
      const choice = await hooks!.requestPermission({
        requestId: 'perm-3', tool: { title: 'edit', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      settleChoice(choice)
      return 'done'
    }
    const session = makeSession('s-cancel', model, stub)
    await collect(session, 'go', (m) => { if (m.type === 'permission:request') session.cancel() })
    // the runTurn finally-block settled the pending permission with { cancelled: true } on abort
    expect(await choiceReceived).toEqual({ cancelled: true })
  })
})
