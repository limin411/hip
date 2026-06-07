// src/domain/sessionService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionService } from './sessionService'
import { useDomainStore } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import type { ConnectionStatus, Transport } from './transport'

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  private handler: ((m: ServerMessage) => void) | null = null
  private statusHandler: ((s: ConnectionStatus) => void) | null = null
  // Mirror the real transport: opening drives a 'connected' status through onStatus.
  async connect() { this.statusHandler?.('connected') }
  disconnect() {}
  send(msg: ClientMessage) { this.sent.push(msg) }
  onMessage(h: (m: ServerMessage) => void) { this.handler = h; return () => { this.handler = null } }
  onStatus(h: (s: ConnectionStatus) => void) { this.statusHandler = h; return () => { this.statusHandler = null } }
  push(m: ServerMessage) { this.handler?.(m) }
  pushStatus(s: ConnectionStatus) { this.statusHandler?.(s) }
}

beforeEach(() => {
  // NOTE: drop the `true` (replace) flag — Zustand v5 setState with replace=true
  // wipes action methods from the store, causing "X is not a function" errors.
  // Using merge (no second arg) keeps actions intact and resets only data fields.
  useDomainStore.setState({ sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAt: 'now', updatedAtMs: 0, loaded: true, messages: [], agents: [], status: 'idle', error: null }], activeSessionId: 's1', connection: 'disconnected' })
  useFsStore.setState({ bySession: {} })
})

describe('SessionService', () => {
  it('sendMessage optimistically appends user message and sends message:send', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.sendMessage('  hello  ')
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', sessionId: 's1', content: 'hello' })
    expect((t.sent.at(-1) as { id?: string }).id).toBeTruthy()
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
    // New model: status flows via transport.onStatus(...) -> setConnection,
    // not a direct setConnection inside connect(). FakeTransport.connect() drives
    // a 'connected' status through the stored handler to mirror a real WS open.
    const t = new FakeTransport()
    await new SessionService(t).connect()
    expect(useDomainStore.getState().connection).toBe('connected')
  })

  it('transport status changes propagate to the store', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.pushStatus('connecting')
    expect(useDomainStore.getState().connection).toBe('connecting')
    t.pushStatus('disconnected')
    expect(useDomainStore.getState().connection).toBe('disconnected')
    t.pushStatus('error')
    expect(useDomainStore.getState().connection).toBe('error')
  })

  it('renameSession optimistically updates the store and sends session:rename', () => {
    const t = new FakeTransport()
    new SessionService(t).renameSession('s1', 'My Title')
    expect(useDomainStore.getState().sessions[0].title).toBe('My Title')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:rename', sessionId: 's1', title: 'My Title' })
  })

  it('setProjectDir optimistically sets cwd and sends session:setCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).setProjectDir('s1', '/proj')
    expect(useDomainStore.getState().sessions[0].config.cwd).toBe('/proj')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setCwd', sessionId: 's1', cwd: '/proj' })
  })

  it('readFile marks the preview loading and sends fs:read', () => {
    const t = new FakeTransport()
    new SessionService(t).readFile('s1', '/proj/a.md')
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'loading', path: '/proj/a.md' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:read', sessionId: 's1', path: '/proj/a.md' })
  })

  it('fs:ls:result populates entries', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:ls:result', sessionId: 's1', path: '/proj', entries: [{ name: 'a.md', path: '/proj/a.md', isDir: false }] })
    expect(useFsStore.getState().bySession.s1.entriesByDir['/proj']).toHaveLength(1)
  })

  it('fs:read:result populates the preview', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:read:result', sessionId: 's1', path: '/proj/a.md', content: '# Hi', encoding: 'utf8', mimeType: 'text/markdown' })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'ready', content: '# Hi' })
  })
})
