import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionService } from './sessionService'
import { useDomainStore, type SessionVM } from './sessionStore'
import { useUiStore } from '@/store/uiStore'
import type { ConnectionStatus, Transport } from './transport'

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  async connect() {}
  disconnect() {}
  send(msg: ClientMessage) { this.sent.push(msg) }
  onMessage(_h: (m: ServerMessage) => void) { return () => {} }
  onStatus(_h: (s: ConnectionStatus) => void) { return () => {} }
}

function vm(id: string, surface: 'chat' | 'code'): SessionVM {
  return { id, config: { llmProvider: 'd', model: '', tools: [], surface }, title: 't', preview: '', updatedAtMs: 1, loaded: true, messages: [], status: 'idle', error: null, interrupt: null }
}

let svc: SessionService
beforeEach(() => {
  svc = new SessionService(new FakeTransport())
  useDomainStore.setState({ sessions: [vm('h1', 'chat'), vm('c1', 'code')], activeSessionId: null })
  useUiStore.setState({ activeView: 'chat', chatSessionId: null, codeSessionId: null })
})

describe('setSurface', () => {
  it('entering code restores its remembered conversation', () => {
    useUiStore.setState({ codeSessionId: 'c1' })
    svc.setSurface('code')
    expect(useUiStore.getState().activeView).toBe('code')
    expect(useDomainStore.getState().activeSessionId).toBe('c1')
  })
  it('entering code with no/invalid remembered id shows new-conversation', () => {
    useUiStore.setState({ codeSessionId: 'gone' })
    svc.setSurface('code')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })
  it('snapshots the leaving surface, then restores it on return', () => {
    useDomainStore.setState({ activeSessionId: 'h1' })
    svc.setSurface('code')   // snapshots chatSessionId = h1
    expect(useUiStore.getState().chatSessionId).toBe('h1')
    svc.setSurface('chat')
    expect(useDomainStore.getState().activeSessionId).toBe('h1')
  })
  it('refuses to restore a conversation from the wrong surface', () => {
    useUiStore.setState({ codeSessionId: 'h1' }) // h1 is a chat session
    svc.setSurface('code')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })

  it('switching to domain deselects the active session and sets activeView', () => {
    useDomainStore.setState({ activeSessionId: 'h1' })
    svc.setSurface('domain')
    expect(useUiStore.getState().activeView).toBe('domain')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })

  it('switching from chat to domain snapshots the chat session id', () => {
    useDomainStore.setState({ activeSessionId: 'h1' })
    useUiStore.setState({ activeView: 'chat' })
    svc.setSurface('domain')
    expect(useUiStore.getState().chatSessionId).toBe('h1')
    expect(useUiStore.getState().activeView).toBe('domain')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })
})

describe('deleteSession surface reconcile', () => {
  it('deleting the active code session does not leave a chat session active on the code surface', () => {
    // newest-first global order: a chat session is newest, then the active code session
    useDomainStore.setState({ sessions: [vm('h1', 'chat'), vm('c1', 'code')], activeSessionId: 'c1' })
    useUiStore.setState({ activeView: 'code', chatSessionId: 'h1', codeSessionId: 'c1' })
    svc.deleteSession('c1')
    const st = useDomainStore.getState()
    // must NOT be the chat session; with no other code session it falls back to new-conversation
    expect(st.activeSessionId).toBeNull()
    expect(useUiStore.getState().codeSessionId).toBeNull()
  })
  it('falls back to the newest same-surface session when one exists', () => {
    useDomainStore.setState({ sessions: [vm('h1', 'chat'), vm('c2', 'code'), vm('c1', 'code')], activeSessionId: 'c1' })
    useUiStore.setState({ activeView: 'code', chatSessionId: 'h1', codeSessionId: 'c1' })
    svc.deleteSession('c1')
    expect(useDomainStore.getState().activeSessionId).toBe('c2')
  })
})
