import { describe, it, expect } from 'vitest'
import { selectUsageTotal, selectContextTokens, tokensFromUsage } from './hooks'
import type { SessionVM } from './sessionStore'
import type { Message } from '@hip/protocol'

function msg(id: string, usage?: { inputTokens: number; outputTokens: number; totalTokens: number }): Message {
  return { id, role: 'assistant', content: 'x', timestamp: 1, ...(usage ? { usage } : {}) }
}

function session(id: string, messages: Message[]): SessionVM {
  return { id, config: { llmProvider: 'deepseek', model: '', tools: [] }, title: 't', preview: 'p', updatedAtMs: 1, loaded: true, messages, status: 'idle', error: null, interrupt: null }
}

describe('tokensFromUsage', () => {
  it('prefers totalTokens when positive', () => {
    expect(tokensFromUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 99 })).toBe(99)
  })

  it('falls back to in+out when total is 0', () => {
    expect(tokensFromUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 0 })).toBe(15)
  })
})

describe('selectContextTokens', () => {
  it('returns last message usage (not cumulative sum)', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('a', { inputTokens: 100_000, outputTokens: 0, totalTokens: 100_000 }),
          msg('b', { inputTokens: 64_000, outputTokens: 0, totalTokens: 64_000 }),
        ]),
      ],
    }
    expect(selectContextTokens(state)).toBe(64_000)
    expect(selectUsageTotal(state)?.totalTokens).toBe(164_000)
  })

  it('skips trailing messages without usage', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('a', { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
          msg('b'), // no usage
        ]),
      ],
    }
    expect(selectContextTokens(state)).toBe(15)
  })

  it('returns null when no usage', () => {
    expect(
      selectContextTokens({ activeSessionId: 's1', sessions: [session('s1', [msg('a')])] }),
    ).toBeNull()
  })
})

describe('selectUsageTotal', () => {
  it('sums usage across the active session’s messages', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('a', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
          msg('b', { inputTokens: 200, outputTokens: 60, totalTokens: 260 }),
          msg('c'), // no usage → skipped
        ]),
        session('s2', [msg('z', { inputTokens: 999, outputTokens: 999, totalTokens: 1998 })]),
      ],
    }
    expect(selectUsageTotal(state)).toEqual({ inputTokens: 300, outputTokens: 110, totalTokens: 410 })
  })

  it('returns null when the active session has no usage at all', () => {
    const state = { activeSessionId: 's1', sessions: [session('s1', [msg('a'), msg('b')])] }
    expect(selectUsageTotal(state)).toBeNull()
  })

  it('returns null when there is no active session', () => {
    const state = { activeSessionId: null, sessions: [] }
    expect(selectUsageTotal(state)).toBeNull()
  })

  it('handles undefined usage fields by treating them as 0', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          // Simulate malformed protocol data where usage fields are undefined at runtime
          { id: 'a', role: 'assistant' as const, content: 'x', timestamp: 1, usage: { inputTokens: undefined as unknown as number, outputTokens: 100, totalTokens: 100 } } as Message,
        ]),
      ],
    }
    expect(selectUsageTotal(state)).toEqual({ inputTokens: 0, outputTokens: 100, totalTokens: 100 })
  })

  it('sums correctly with mixed usage and non-usage messages', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('a', { inputTokens: 10, outputTokens: 20, totalTokens: 30 }),
          msg('b'), // no usage → skipped
          msg('c', { inputTokens: 40, outputTokens: 50, totalTokens: 90 }),
        ]),
      ],
    }
    expect(selectUsageTotal(state)).toEqual({ inputTokens: 50, outputTokens: 70, totalTokens: 120 })
  })
})
