// src/domain/sessionService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionService } from './sessionService'
import { useDomainStore } from './sessionStore'
import type { Transport } from './transport'

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  private handler: ((m: ServerMessage) => void) | null = null
  async connect() {}
  disconnect() {}
  send(msg: ClientMessage) { this.sent.push(msg) }
  onMessage(h: (m: ServerMessage) => void) { this.handler = h; return () => { this.handler = null } }
  push(m: ServerMessage) { this.handler?.(m) }
}

beforeEach(() => {
  // NOTE: drop the `true` (replace) flag — Zustand v5 setState with replace=true
  // wipes action methods from the store, causing "X is not a function" errors.
  // Using merge (no second arg) keeps actions intact and resets only data fields.
  useDomainStore.setState({ sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAt: 'now', messages: [], agents: [], status: 'idle' }], activeSessionId: 's1', connection: 'disconnected' })
})

describe('SessionService', () => {
  it('sendMessage optimistically appends user message and sends message:send', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.sendMessage('  hello  ')
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', sessionId: 's1', content: 'hello' })
  })

  it('sendMessage ignores blank input', () => {
    const t = new FakeTransport()
    new SessionService(t).sendMessage('   ')
    expect(t.sent).toHaveLength(0)
  })

  it('inbound ServerMessage flows into the store', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'planner' })
    expect(useDomainStore.getState().sessions[0].agents[0].title).toBe('Planner')
  })

  it('createSession sends session:create and activates', () => {
    const t = new FakeTransport()
    const id = new SessionService(t).createSession()
    expect(useDomainStore.getState().activeSessionId).toBe(id)
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:create', id })
  })

  it('connect updates connection status', async () => {
    const t = new FakeTransport()
    await new SessionService(t).connect()
    expect(useDomainStore.getState().connection).toBe('connected')
  })
})
