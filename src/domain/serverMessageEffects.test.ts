import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useDomainStore } from './sessionStore'
import { useDiffStore } from '@/store/diffStore'

function makeDeps(overrides: Partial<ServerMessageEffectDeps> = {}): ServerMessageEffectDeps & {
  sent: Array<{ type: string }>
} {
  const sent: Array<{ type: string }> = []
  return {
    sent,
    send: (msg) => { sent.push(msg) },
    requestDiff: vi.fn(),
    requestCheckpoints: vi.fn(),
    requestCommitLog: vi.fn(),
    resyncActiveIfRunning: vi.fn(),
    ...overrides,
  }
}

describe('applyServerMessageEffects', () => {
  beforeEach(() => {
    useDomainStore.setState({
      sessions: [{
        id: 's1',
        config: { llmProvider: 'deepseek', model: '', tools: [] },
        title: '',
        preview: '',
        updatedAtMs: 0,
        loaded: true,
        messages: [],
        status: 'idle',
        error: null,
      }],
      activeSessionId: 's1',
      connection: 'connected',
      searching: false,
      pluginInstall: null,
    })
    useDiffStore.setState({ bySession: {} })
  })

  it('ready resets diff transient and requests session:list', () => {
    const deps = makeDeps()
    applyServerMessageEffects({ type: 'ready', hasApiKey: true }, deps)
    expect(deps.sent.some((m) => m.type === 'session:list')).toBe(true)
    expect(deps.resyncActiveIfRunning).toHaveBeenCalled()
  })

  it('compact:result ok appends a summary assistant message', () => {
    const deps = makeDeps()
    applyServerMessageEffects({
      type: 'compact:result',
      sessionId: 's1',
      ok: true,
      inputTokens: 1,
      outputTokens: 2,
      messagesBefore: 10,
      messagesAfter: 4,
    }, deps)
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toContain('10 messages → 4 messages')
  })
})
