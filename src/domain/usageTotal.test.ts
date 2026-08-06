import { describe, it, expect } from 'vitest'
import {
  selectUsageTotal,
  selectContextTokens,
  tokensFromUsage,
  collectUsagesForCost,
  computeSessionCostUsd,
  sumMessageUsages,
} from './hooks'
import type { SessionVM } from './sessionStore'
import type { Message } from '@hip/protocol'
import type { Catalog } from '@/ipc/catalog'

function msg(
  id: string,
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; contextTokens?: number },
  content = 'x',
): Message {
  return { id, role: 'assistant', content, timestamp: 1, ...(usage ? { usage } : {}) }
}

function session(id: string, messages: Message[]): SessionVM {
  return { id, config: { llmProvider: 'deepseek', model: '', tools: [] }, title: 't', preview: 'p', updatedAtMs: 1, loaded: true, messages, status: 'idle', error: null, interrupt: null }
}

describe('tokensFromUsage', () => {
  it('prefers contextTokens when present (multi-step last/max request size)', () => {
    expect(
      tokensFromUsage({
        inputTokens: 300_000,
        outputTokens: 600,
        totalTokens: 300_600,
        contextTokens: 200_000,
      }),
    ).toBe(200_000)
  })

  it('prefers inputTokens when contextTokens absent', () => {
    expect(tokensFromUsage({ inputTokens: 99, outputTokens: 2, totalTokens: 101 })).toBe(99)
  })

  it('does not treat billing total as context when input is 0 (MiniMax stream usage)', () => {
    expect(tokensFromUsage({ inputTokens: 0, outputTokens: 65, totalTokens: 65 })).toBe(0)
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

  it('uses contextTokens for fill when multi-step sum exceeds last request', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('b', {
            inputTokens: 2_700_000,
            outputTokens: 6_000,
            totalTokens: 2_706_000,
            contextTokens: 800_000,
          }),
        ]),
      ],
    }
    expect(selectContextTokens(state)).toBe(800_000)
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
    // max(reported 10, visible estimate) — content is tiny so reported wins
    expect(selectContextTokens(state)).toBe(10)
  })

  it('falls back to visible estimate when provider reports input_tokens=0', () => {
    const long = 'hello world '.repeat(500) // ~6000 chars → ~1500 tokens
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          { id: 'u1', role: 'user' as const, content: long, timestamp: 1 },
          msg('a', { inputTokens: 0, outputTokens: 65, totalTokens: 65, contextTokens: 65 }, long),
        ]),
      ],
    }
    const fill = selectContextTokens(state)
    expect(fill).toBeGreaterThan(1000)
    // Must not stick at the bogus output-only contextTokens
    expect(fill).toBeGreaterThan(65)
  })

  it('returns null when no usage and empty transcript', () => {
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

  it('ORs incomplete and sums cache fields', () => {
    const total = sumMessageUsages([
      msg('a', {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        cacheReadTokens: 40,
        incomplete: true,
      } as never),
      msg('b', {
        inputTokens: 50,
        outputTokens: 5,
        totalTokens: 55,
        cacheReadTokens: 10,
      } as never),
    ])
    expect(total).toMatchObject({
      inputTokens: 150,
      outputTokens: 15,
      totalTokens: 165,
      cacheReadTokens: 50,
      incomplete: true,
    })
  })
})

describe('computeSessionCostUsd (per-usage model rates)', () => {
  const catalog: Catalog = {
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      env: [],
      models: {
        'deepseek-chat': {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat',
          cost: { input: 0.27, output: 1.1 },
        },
      },
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      env: [],
      models: {
        'claude-sonnet': {
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        },
      },
    },
  }

  it('sums cost with each usage priced at its modelId (KD-5)', () => {
    const messages: Message[] = [
      msg('a', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
        modelId: 'claude-sonnet',
        providerId: 'anthropic',
      } as never),
      msg('b', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
        modelId: 'deepseek-chat',
        providerId: 'deepseek',
      } as never),
    ]
    // Session is now on deepseek — claude row must still use claude rates (KD-22)
    const { costUsd } = computeSessionCostUsd(messages, catalog, 'deepseek', 'deepseek-chat')
    expect(costUsd).toBeCloseTo(3.27, 10)
  })

  it('prefers agent run usages over turn-level fold for cost', () => {
    const messages: Message[] = [
      {
        id: 'a',
        role: 'assistant',
        content: 'x',
        timestamp: 1,
        // Turn blob would wrongly use last model only
        usage: {
          inputTokens: 2_000_000,
          outputTokens: 0,
          totalTokens: 2_000_000,
          modelId: 'deepseek-chat',
          providerId: 'deepseek',
        },
        agentRuns: [
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: '',
            startedAt: 1,
            finishedAt: 2,
            seq: 0,
            usage: {
              inputTokens: 1_000_000,
              outputTokens: 0,
              totalTokens: 1_000_000,
              modelId: 'claude-sonnet',
              providerId: 'anthropic',
            },
          },
          {
            agentId: 'worker',
            role: 'worker',
            output: '',
            startedAt: 1,
            finishedAt: 2,
            seq: 1,
            usage: {
              inputTokens: 1_000_000,
              outputTokens: 0,
              totalTokens: 1_000_000,
              modelId: 'deepseek-chat',
              providerId: 'deepseek',
            },
          },
        ],
      },
    ]
    expect(collectUsagesForCost(messages)).toHaveLength(2)
    const { costUsd } = computeSessionCostUsd(messages, catalog, 'deepseek', 'deepseek-chat')
    // 3 + 0.27, not 2 * 0.27
    expect(costUsd).toBeCloseTo(3.27, 10)
  })

  it('flags incomplete lower-bound cost (KD-15)', () => {
    const messages: Message[] = [
      msg('a', {
        inputTokens: 100_000,
        outputTokens: 0,
        totalTokens: 100_000,
        incomplete: true,
        modelId: 'deepseek-chat',
        providerId: 'deepseek',
      } as never),
    ]
    const { costUsd, incomplete } = computeSessionCostUsd(
      messages,
      catalog,
      'deepseek',
      'deepseek-chat',
    )
    expect(incomplete).toBe(true)
    expect(costUsd).toBeCloseTo(0.027, 10)
  })
})
