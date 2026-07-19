import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyServerMessageEffects, type ServerMessageEffectDeps } from './serverMessageEffects'
import { useDomainStore } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useFocusStore } from '@/store/focusStore'
describe('write-follow effects (P1 C1)', () => {
  beforeEach(() => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          config: { llmProvider: 'deepseek', model: 'x', tools: [], surface: 'code', cwd: '/tmp/p' },
          title: 't',
          preview: '',
          updatedAtMs: 0,
          loaded: true,
          messages: [
            {
              id: 't1',
              role: 'assistant',
              content: '',
              timestamp: 1,
              toolCalls: [
                {
                  callId: 'c1',
                  agentId: 'coder',
                  name: 'write_file',
                  input: JSON.stringify({ path: '/README.md', content: 'hi' }),
                  status: 'running',
                  seq: 1,
                },
              ],
            },
          ],
          status: 'running',
          error: null,
        },
      ],
      activeSessionId: 's1',
    } as never)
    useFsStore.setState({ bySession: {} } as never)
    useFocusStore.setState({
      autoFollowEdits: true,
      followPaused: false,
      focusedPath: null,
      focusedCallId: null,
      focusedAgentId: null,
    })
  })

  it('sets preview path on write tool:finished before message complete', () => {
    const send = vi.fn()
    const deps: ServerMessageEffectDeps = {
      send,
      requestDiff: vi.fn(),
      requestCheckpoints: vi.fn(),
      requestCommitLog: vi.fn(),
      resyncActiveIfRunning: vi.fn(),
    }
    applyServerMessageEffects(
      {
        type: 'tool:finished',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'coder',
        callId: 'c1',
        status: 'finished',
        output: 'wrote',
      },
      deps,
    )
    const prev = useFsStore.getState().bySession['s1']?.preview
    expect(prev && prev.status !== 'idle' ? prev.path : undefined).toBe('/README.md')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'fs:read', path: '/README.md' }))
    expect(useFocusStore.getState().focusedPath).toBe('/README.md')
  })

  it('skips follow when paused', () => {
    useFocusStore.setState({ followPaused: true })
    const send = vi.fn()
    applyServerMessageEffects(
      {
        type: 'tool:finished',
        sessionId: 's1',
        turnId: 't1',
        agentId: 'coder',
        callId: 'c1',
        status: 'finished',
        output: 'wrote',
      },
      {
        send,
        requestDiff: vi.fn(),
        requestCheckpoints: vi.fn(),
        requestCommitLog: vi.fn(),
        resyncActiveIfRunning: vi.fn(),
      },
    )
    const prev = useFsStore.getState().bySession['s1']?.preview
    expect(prev && prev.status !== 'idle' ? prev.path : undefined).toBeUndefined()
  })
})
