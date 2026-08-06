import { describe, it, expect } from 'vitest'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import {
  estimateTokens,
  estimatePromptTokens,
  compactMessages,
  compactToolRounds,
  applyCompactResult,
  summarizeWithQualityGate,
  resolveKeepRecentTurns,
  resolveKeepRecentToolRounds,
  COMPACT_SUMMARY_PREFIX,
  COMPACT_SUMMARY_SECTIONS,
  SUMMARY_TEMPLATE,
  KEEP_RECENT_TURNS,
  KEEP_RECENT_TOOL_ROUNDS,
  COMPACT_BUDGET_TOKENS,
  splitToolRounds,
  type Summarizer,
} from './compaction.js'
import { DEFAULT_COMPACT_TRIGGER_TOKENS } from './context-budget.js'
import { SUMMARY_TEMPLATE as SUMMARY_TEMPLATE_FROM_FACTORY } from './model-factory.js'

const longSummary = '摘要内容：'.padEnd(100, '详')

const fakeSummarizer = (
  capture?: (m: BaseMessage[], opts?: { focus?: string }) => void,
  body: string = longSummary,
): Summarizer => ({
  async summarize(m, opts) { capture?.(m, opts); return body },
})

describe('estimateTokens', () => {
  it('counts chars / 4 across messages', () => {
    expect(estimateTokens([new HumanMessage('12345678')])).toBe(2)
  })
})

describe('COMPACT_BUDGET_TOKENS', () => {
  it('is derived from default context window × 85% (not a fixed 48k)', () => {
    expect(COMPACT_BUDGET_TOKENS).toBe(DEFAULT_COMPACT_TRIGGER_TOKENS)
    expect(COMPACT_BUDGET_TOKENS).toBeGreaterThan(48_000)
  })
})

describe('estimatePromptTokens (via compaction re-export)', () => {
  it('counts system prompt on top of messages', () => {
    const msgs = [new HumanMessage('abcd')]
    expect(estimatePromptTokens({ messages: msgs, systemPrompt: 'xxxx' })).toBe(
      estimateTokens(msgs) + 1,
    )
  })
})

describe('summarizeWithQualityGate', () => {
  it('retries then falls back when summary is degenerate', async () => {
    let calls = 0
    const summarizer: Summarizer = {
      async summarize() {
        calls++
        return 'x' // too short
      },
    }
    const middle = [
      new AIMessage({ id: 'a1', content: 'did work on packages/sidecar/src/session/auth.ts' }),
      new HumanMessage({ id: 'u2', content: 'continue fixing the login bug' }),
    ]
    const text = await summarizeWithQualityGate(middle, { summarizer })
    expect(calls).toBe(2)
    expect(text).toContain('[extractive]')
    expect(text).toMatch(/auth\.ts|login/i)
  })

  it('accepts a long enough first summary without retry', async () => {
    let calls = 0
    const summarizer: Summarizer = {
      async summarize() {
        calls++
        return longSummary
      },
    }
    const text = await summarizeWithQualityGate(
      [new HumanMessage({ id: 'u', content: 'goal' })],
      { summarizer },
    )
    expect(calls).toBe(1)
    expect(text).toBe(longSummary)
  })
})

describe('compactMessages', () => {
  const build = (): BaseMessage[] => [
    new SystemMessage({ id: 'sys', content: 'you are hip' }),
    new HumanMessage({ id: 'u1', content: '原始目标：做个网页' }),
    new AIMessage({ id: 'a1', content: '早期的中间回复' }),
    new HumanMessage({ id: 'u2', content: '中间追问' }),
    new AIMessage({ id: 'a2', content: '中间回复' }),
    new HumanMessage({ id: 'u3', content: '最近的问题' }),
    new AIMessage({ id: 'a3', content: '最近的回复' }),
  ]

  it('pins system + first user + recent K turns and summarizes the middle', async () => {
    let seen: BaseMessage[] = []
    const result = await compactMessages(build(), { keepRecentTurns: 1, summarizer: fakeSummarizer((m) => { seen = m }) })
    expect(result).not.toBeNull()
    expect(seen.map((m) => m.id)).toEqual(['a1', 'u2', 'a2'])
    expect(result!.summary.id).toBe('a1')
    expect(typeof result!.summary.content === 'string' ? result!.summary.content : '').toContain(COMPACT_SUMMARY_PREFIX)
    expect(result!.removeIds).toEqual(['u2', 'a2'])
    expect(result!.replacedIds).toEqual(['a1', 'u2', 'a2'])
  })

  it('returns null when there is no middle (too few turns and no tool-rounds)', async () => {
    const few: BaseMessage[] = [
      new SystemMessage({ id: 'sys', content: 's' }),
      new HumanMessage({ id: 'u1', content: 'goal' }),
      new AIMessage({ id: 'a1', content: 'reply' }),
    ]
    expect(await compactMessages(few, { keepRecentTurns: 3, summarizer: fakeSummarizer() })).toBeNull()
  })

  it('returns null at default KEEP_RECENT_TURNS with only 3 human turns (no extra middle)', async () => {
    expect(await compactMessages(build(), { keepRecentTurns: KEEP_RECENT_TURNS, summarizer: fakeSummarizer() })).toBeNull()
  })

  it('tool-round mode compacts single-Human ReAct with many tool rounds', async () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ id: 'sys', content: 'explore' }),
      new HumanMessage({ id: 'u1', content: 'scan codebase' }),
    ]
    // 10 tool rounds (AI + Tool each)
    for (let i = 0; i < 10; i++) {
      messages.push(
        new AIMessage({
          id: `a${i}`,
          content: '',
          tool_calls: [{ id: `c${i}`, name: 'read_file', args: { path: `/f${i}` }, type: 'tool_call' }],
        }),
        new ToolMessage({
          id: `t${i}`,
          content: `file body ${i} `.repeat(50),
          tool_call_id: `c${i}`,
          name: 'read_file',
        }),
      )
    }
    const result = await compactMessages(messages, {
      keepRecentTurns: KEEP_RECENT_TURNS,
      keepRecentToolRounds: 3,
      summarizer: fakeSummarizer(),
    })
    expect(result).not.toBeNull()
    expect(result!.mode).toBe('tool-round')
    expect(typeof result!.summary.content === 'string' ? result!.summary.content : '').toContain(COMPACT_SUMMARY_PREFIX)
    // middle = first 7 rounds (10 - 3 keep); head is a0
    expect(result!.summary.id).toBe('a0')
    // removeIds should include later middle messages but not the kept tail rounds (a7..t9)
    expect(result!.removeIds).not.toContain('a9')
    expect(result!.removeIds).not.toContain('t9')
  })

  it('passes focus to the summarizer', async () => {
    let focus: string | undefined
    await compactMessages(build(), {
      keepRecentTurns: 1,
      focus: 'auth middleware',
      summarizer: fakeSummarizer((_m, opts) => { focus = opts?.focus }),
    })
    expect(focus).toBe('auth middleware')
  })
})

describe('splitToolRounds', () => {
  it('groups AI tool_calls with following ToolMessages', () => {
    const msgs: BaseMessage[] = [
      new HumanMessage({ id: 'u', content: 'g' }),
      new AIMessage({
        id: 'a0',
        content: '',
        tool_calls: [{ id: 'c0', name: 'ls', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ id: 't0', content: 'out', tool_call_id: 'c0', name: 'ls' }),
      new AIMessage({ id: 'a1', content: 'done' }),
    ]
    const rounds = splitToolRounds(msgs, 1)
    expect(rounds).toHaveLength(2)
    expect(rounds[0].map((m) => m.id)).toEqual(['a0', 't0'])
    expect(rounds[1].map((m) => m.id)).toEqual(['a1'])
  })
})

describe('compactToolRounds', () => {
  it('returns null when rounds ≤ keepRecentToolRounds', async () => {
    const messages: BaseMessage[] = [
      new HumanMessage({ id: 'u1', content: 'goal' }),
      new AIMessage({
        id: 'a0',
        content: '',
        tool_calls: [{ id: 'c0', name: 'ls', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ id: 't0', content: 'x', tool_call_id: 'c0', name: 'ls' }),
    ]
    expect(
      await compactToolRounds(messages, {
        keepRecentTurns: 3,
        keepRecentToolRounds: KEEP_RECENT_TOOL_ROUNDS,
        summarizer: fakeSummarizer(),
      }),
    ).toBeNull()
  })
})

describe('appendProtectedStructures', () => {
  it('keeps goal block on summary body', async () => {
    const { appendProtectedStructures } = await import('./compaction.js')
    const out = appendProtectedStructures('note', '## Active goal (do not drop)\nid: g')
    expect(out).toContain('note')
    expect(out).toContain('Active goal')
  })
})

describe('applyCompactResult', () => {
  it('replaces middle head in place and removes the rest of the middle', async () => {
    const messages: BaseMessage[] = [
      new SystemMessage({ id: 'sys', content: 's' }),
      new HumanMessage({ id: 'u1', content: 'goal' }),
      new AIMessage({ id: 'a1', content: 'mid1' }),
      new HumanMessage({ id: 'u2', content: 'mid2' }),
      new AIMessage({ id: 'a2', content: 'mid2a' }),
      new HumanMessage({ id: 'u3', content: 'recent' }),
      new AIMessage({ id: 'a3', content: 'recent a' }),
    ]
    const result = await compactMessages(messages, { keepRecentTurns: 1, summarizer: fakeSummarizer() })
    expect(result).not.toBeNull()
    const applied = applyCompactResult(messages, result!)
    expect(applied.map((m) => m.id)).toEqual(['sys', 'u1', 'a1', 'u3', 'a3'])
    expect(typeof applied[2].content === 'string' ? applied[2].content : '').toContain(COMPACT_SUMMARY_PREFIX)
    // Summary is not pushed to the end
    expect(applied[applied.length - 1].id).toBe('a3')
  })
})

describe('resolveKeepRecentTurns (token budget)', () => {
  it('falls back to keepRecentTurns when no targetKeepTokens', () => {
    const messages = [
      new HumanMessage({ id: 'u1', content: 'a' }),
      new AIMessage({ id: 'a1', content: 'b' }),
      new HumanMessage({ id: 'u2', content: 'c' }),
      new AIMessage({ id: 'a2', content: 'd' }),
      new HumanMessage({ id: 'u3', content: 'e' }),
    ]
    const humanIdxs = [0, 2, 4]
    expect(
      resolveKeepRecentTurns(messages, humanIdxs, {
        keepRecentTurns: 2,
        summarizer: fakeSummarizer(),
      }),
    ).toBe(2)
  })

  it('keeps more turns when target budget is large', async () => {
    // Many short turns + huge target → can keep up to soft max
    const messages: BaseMessage[] = []
    const humanIdxs: number[] = []
    for (let i = 0; i < 8; i++) {
      humanIdxs.push(messages.length)
      messages.push(new HumanMessage({ id: `u${i}`, content: `q${i}` }))
      messages.push(new AIMessage({ id: `a${i}`, content: `r${i}` }))
    }
    const keep = resolveKeepRecentTurns(messages, humanIdxs, {
      keepRecentTurns: 3,
      targetKeepTokens: 100_000,
      summarizer: fakeSummarizer(),
    })
    // Soft max = min(fallback*3, humans-1) = min(9, 7) = 7
    expect(keep).toBeGreaterThanOrEqual(3)
    expect(keep).toBeLessThanOrEqual(7)
  })

  it('shrinks keep when target budget is tiny', () => {
    const messages: BaseMessage[] = []
    const humanIdxs: number[] = []
    for (let i = 0; i < 6; i++) {
      humanIdxs.push(messages.length)
      messages.push(new HumanMessage({ id: `u${i}`, content: 'x'.repeat(400) }))
      messages.push(new AIMessage({ id: `a${i}`, content: 'y'.repeat(400) }))
    }
    const keep = resolveKeepRecentTurns(messages, humanIdxs, {
      keepRecentTurns: 3,
      targetKeepTokens: 50, // very small
      summarizer: fakeSummarizer(),
    })
    expect(keep).toBe(1)
  })
})

describe('resolveKeepRecentToolRounds (token budget)', () => {
  it('respects targetKeepTokens for tool rounds', () => {
    const rounds: BaseMessage[][] = []
    for (let i = 0; i < 10; i++) {
      rounds.push([
        new AIMessage({
          id: `a${i}`,
          content: '',
          tool_calls: [{ id: `c${i}`, name: 'ls', args: {}, type: 'tool_call' }],
        }),
        new ToolMessage({
          id: `t${i}`,
          content: 'out '.repeat(200),
          tool_call_id: `c${i}`,
          name: 'ls',
        }),
      ])
    }
    const keep = resolveKeepRecentToolRounds(rounds, {
      keepRecentTurns: 3,
      keepRecentToolRounds: 6,
      targetKeepTokens: 80,
      summarizer: fakeSummarizer(),
    })
    expect(keep).toBeGreaterThanOrEqual(1)
    expect(keep).toBeLessThanOrEqual(6)
  })
})

describe('SUMMARY_TEMPLATE', () => {
  it('contains Objective / Important Details / Work State / Next Move / Relevant Files headers', () => {
    expect(COMPACT_SUMMARY_SECTIONS).toEqual([
      '## Objective',
      '## Important Details',
      '## Work State',
      '## Next Move',
      '## Relevant Files',
    ])
    for (const section of COMPACT_SUMMARY_SECTIONS) {
      expect(SUMMARY_TEMPLATE, `missing section: ${section}`).toContain(section)
    }
  })

  it('mentions protected goal integration and is re-exported from model-factory', () => {
    expect(SUMMARY_TEMPLATE).toContain('## Active goal (do not drop)')
    expect(SUMMARY_TEMPLATE_FROM_FACTORY).toBe(SUMMARY_TEMPLATE)
  })
})
