import { describe, it, expect } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { runTurn } from './turn-runner.js'

function fakeBus() {
  const handlers = new Set<(m: ServerMessage) => void>()
  const sent: ClientMessage[] = []
  return {
    sent,
    send: (m: ClientMessage) => {
      sent.push(m)
    },
    subscribe: (h: (m: ServerMessage) => void) => {
      handlers.add(h)
      return () => handlers.delete(h)
    },
    emit: (m: ServerMessage) => {
      for (const h of handlers) h(m)
    },
  }
}

function baseOpts(bus: ReturnType<typeof fakeBus>) {
  return {
    sessionId: 's1',
    userMessageId: 'u1',
    prompt: 'hi',
    hitl: 'auto' as const,
    maxPlanApprovals: 1,
    settleMs: 50,
    deadlineAt: null as number | null,
    send: bus.send,
    subscribe: bus.subscribe,
  }
}

describe('runTurn settle (fake WS)', () => {
  it('clean complete → ok', async () => {
    const bus = fakeBus()
    const p = runTurn(baseOpts(bus))
    await Promise.resolve()
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'pong',
        timestamp: Date.now(),
      },
    })
    const out = await p
    expect(out.status).toBe('ok')
    expect(out.exitCode).toBe(0)
    expect(out.text).toBe('pong')
  })

  it('complete(stopped)+plan_approval auto → second complete ok', async () => {
    const bus = fakeBus()
    const p = runTurn(baseOpts(bus))
    await Promise.resolve()
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'plan…',
        timestamp: Date.now(),
        stopped: true,
      },
    })
    bus.emit({
      type: 'agent:interrupt',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'supervisor',
      question: 'Approve plan?',
      context: JSON.stringify({ kind: 'plan_approval', plan: [] }),
    })
    await Promise.resolve()
    expect(bus.sent.some((m) => m.type === 'plan:respond')).toBe(true)
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a2',
        role: 'assistant',
        content: 'done',
        timestamp: Date.now(),
      },
    })
    const out = await p
    expect(out.status).toBe('ok')
    expect(out.exitCode).toBe(0)
    expect(out.turn.completeCount).toBe(2)
  })

  it('complete(stopped)+other interrupt auto → awaiting_user/5', async () => {
    const bus = fakeBus()
    const p = runTurn(baseOpts(bus))
    await Promise.resolve()
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'x',
        timestamp: Date.now(),
        stopped: true,
      },
    })
    bus.emit({
      type: 'agent:interrupt',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'supervisor',
      question: 'doom?',
      context: JSON.stringify({ kind: 'doom_loop' }),
    })
    const out = await p
    expect(out.status).toBe('awaiting_user')
    expect(out.exitCode).toBe(5)
  })

  it('complete(stopped)+error TIMEOUT → timeout/4', async () => {
    const bus = fakeBus()
    const p = runTurn(baseOpts(bus))
    await Promise.resolve()
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'partial',
        timestamp: Date.now(),
        stopped: true,
      },
    })
    bus.emit({ type: 'error', sessionId: 's1', code: 'TIMEOUT', message: 'idle' })
    const out = await p
    expect(out.status).toBe('timeout')
    expect(out.exitCode).toBe(4)
  })

  it('complete(stopped)+error CANCELLED → cancelled/130', async () => {
    const bus = fakeBus()
    const p = runTurn(baseOpts(bus))
    await Promise.resolve()
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'partial',
        timestamp: Date.now(),
        stopped: true,
      },
    })
    bus.emit({ type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'cancel' })
    const out = await p
    expect(out.status).toBe('cancelled')
    expect(out.exitCode).toBe(130)
  })

  it('complete(stopped)+settle timeout → awaiting_user/5', async () => {
    const bus = fakeBus()
    const p = runTurn({ ...baseOpts(bus), settleMs: 30 })
    await Promise.resolve()
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'x',
        timestamp: Date.now(),
        stopped: true,
      },
    })
    const out = await p
    expect(out.status).toBe('awaiting_user')
    expect(out.exitCode).toBe(5)
  })

  it('permission:request fail → hitl_blocked/5', async () => {
    const bus = fakeBus()
    const p = runTurn({ ...baseOpts(bus), hitl: 'fail' })
    await Promise.resolve()
    bus.emit({
      type: 'permission:request',
      sessionId: 's1',
      turnId: 't',
      requestId: 'r1',
      tool: { title: 'run', kind: 'execute' },
      options: [{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' }],
    })
    const out = await p
    expect(out.status).toBe('hitl_blocked')
    expect(out.exitCode).toBe(5)
  })

  it('permission:request auto with once optionId', async () => {
    const bus = fakeBus()
    const p = runTurn(baseOpts(bus))
    await Promise.resolve()
    bus.emit({
      type: 'permission:request',
      sessionId: 's1',
      turnId: 't',
      requestId: 'r1',
      tool: { title: 'run', kind: 'execute' },
      options: [{ optionId: 'once', name: 'Allow', kind: 'allow_once' }],
    })
    await Promise.resolve()
    expect(bus.sent.some((m) => m.type === 'permission:respond' && 'optionId' in m && m.optionId === 'once')).toBe(
      true,
    )
    bus.emit({
      type: 'message:complete',
      sessionId: 's1',
      message: { id: 'a1', role: 'assistant', content: 'ok', timestamp: Date.now() },
    })
    const out = await p
    expect(out.status).toBe('ok')
  })
})
