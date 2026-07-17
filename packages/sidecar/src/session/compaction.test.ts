import { describe, it, expect } from 'vitest'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import {
  estimateTokens,
  compactMessages,
  compactToolRounds,
  applyCompactResult,
  KEEP_RECENT_TURNS,
  KEEP_RECENT_TOOL_ROUNDS,
  splitToolRounds,
  type Summarizer,
} from './compaction.js'
import { SUMMARY_TEMPLATE } from './model-factory.js'

const fakeSummarizer = (
  capture?: (m: BaseMessage[], opts?: { focus?: string }) => void,
): Summarizer => ({
  async summarize(m, opts) { capture?.(m, opts); return '摘要内容' },
})

describe('estimateTokens', () => {
  it('counts chars / 4 across messages', () => {
    expect(estimateTokens([new HumanMessage('12345678')])).toBe(2)
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
    expect(typeof result!.summary.content === 'string' ? result!.summary.content : '').toContain('[对话摘要]')
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
    expect(typeof result!.summary.content === 'string' ? result!.summary.content : '').toContain('[对话摘要]')
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
    expect(typeof applied[2].content === 'string' ? applied[2].content : '').toContain('[对话摘要]')
    // Summary is not pushed to the end
    expect(applied[applied.length - 1].id).toBe('a3')
  })
})

describe('SUMMARY_TEMPLATE', () => {
  const requiredSections = [
    '## Goal',
    '## Constraints & Preferences',
    '## Progress',
    '### Done',
    '### In Progress',
    '### Blocked',
    '## Key Decisions',
    '## Next Steps',
    '## Critical Context',
    '## Relevant Files',
    '## Files Modified',
  ]

  it('contains all 8 structured section headers', () => {
    for (const section of requiredSections) {
      expect(SUMMARY_TEMPLATE, `missing section: ${section}`).toContain(section)
    }
  })
})
