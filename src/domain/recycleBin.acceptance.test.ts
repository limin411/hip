/**
 * Paid-LLM-free acceptance for design success criteria (frontend domain).
 * Sidecar soft/purge covered by packages/sidecar store + trash-retention tests.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyServerMessage, useDomainStore } from './sessionStore'
import type { SessionConfig } from '@hip/protocol'

const cfg: SessionConfig = {
  llmProvider: 'deepseek',
  model: 'deepseek-chat',
  tools: [],
  surface: 'chat',
}

describe('recycle bin acceptance (domain)', () => {
  beforeEach(() => {
    useDomainStore.setState({ sessions: [], activeSessionId: null })
  })

  it('session:trashed removes from domain list', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'A',
          preview: '',
          updatedAtMs: 1,
          loaded: false,
          messages: [],
          status: 'idle',
          error: null,
          config: cfg,
        },
      ],
      activeSessionId: 's1',
    })
    const state = useDomainStore.getState()
    const next = applyServerMessage(
      state,
      { type: 'session:trashed', sessionId: 's1', deletedAt: 1 },
      0,
    )
    expect(next.sessions).toHaveLength(0)
  })

  it('session:restored merges summary without marking loaded', () => {
    const state = useDomainStore.getState()
    const next = applyServerMessage(
      state,
      {
        type: 'session:restored',
        sessionId: 's1',
        summary: {
          id: 's1',
          title: 'A',
          preview: 'p',
          updatedAt: 2,
          messageCount: 1,
          surface: 'chat',
        },
      },
      0,
    )
    expect(next.sessions.map((s) => s.id)).toContain('s1')
    expect(next.sessions.find((s) => s.id === 's1')?.loaded).toBe(false)
    // Restore must not auto-select: applyServerMessage only returns sessions/pluginInstall
    // and does not touch store activeSessionId (still null from beforeEach).
    expect(state.activeSessionId).toBeNull()
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })

  it('session:deleted hard path also removes from list', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'A',
          preview: '',
          updatedAtMs: 1,
          loaded: false,
          messages: [],
          status: 'idle',
          error: null,
          config: cfg,
        },
      ],
      activeSessionId: null,
    })
    const next = applyServerMessage(
      useDomainStore.getState(),
      { type: 'session:deleted', sessionId: 's1' },
      0,
    )
    expect(next.sessions).toHaveLength(0)
  })
})
