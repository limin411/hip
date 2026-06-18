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
})
