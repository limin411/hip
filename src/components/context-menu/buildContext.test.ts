import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createContextMenuBuildContext } from './buildContext'
import { useDomainStore } from '@/domain'
import { useUiStore } from '@/store/uiStore'

describe('createContextMenuBuildContext', () => {
  beforeEach(() => {
    useUiStore.setState({
      activeView: 'code',
      chatSessionId: null,
      codeSessionId: 's1',
    })
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { llmProvider: 'x', model: '', tools: [], surface: 'code' } as never,
          title: 'one',
          preview: '',
          updatedAtMs: 1,
          loaded: true,
          messages: [],
          status: 'running',
          error: null,
          interrupt: { turnId: 't1', question: 'q' },
        },
        {
          id: 's2',
          config: { llmProvider: 'x', model: '', tools: [], surface: 'chat' } as never,
          title: 'two',
          preview: '',
          updatedAtMs: 2,
          loaded: true,
          messages: [],
          status: 'idle',
          error: null,
          interrupt: null,
        },
      ],
      activeSessionId: 's1',
    })
  })

  it('reads active session snapshot from stores', () => {
    const t = vi.fn((k: string) => k) as never
    const ctx = createContextMenuBuildContext(t)
    expect(ctx.activeView).toBe('code')
    expect(ctx.surface).toBe('code')
    expect(ctx.activeSessionId).toBe('s1')
    expect(ctx.sessionStatus).toBe('running')
    expect(ctx.sessionInterrupt).toBe(true)
    expect(typeof ctx.copyText).toBe('function')
  })

  it('uses opts.sessionId for status when provided', () => {
    const t = vi.fn((k: string) => k) as never
    const ctx = createContextMenuBuildContext(t, { sessionId: 's2' })
    expect(ctx.activeSessionId).toBe('s1')
    expect(ctx.sessionStatus).toBe('idle')
    expect(ctx.sessionInterrupt).toBe(false)
  })
})
