import { describe, it, expect } from 'vitest'
import type { Message } from '@hip/protocol'
import {
  estimateTokensFromChars,
  estimateContextBreakdown,
  isSkillToolName,
  countVisibleContextChars,
  selectLastUsage,
  inputBudgetFromUsage,
  toCoarseContextBreakdown,
} from './contextBreakdown'

function user(id: string, content: string): Message {
  return { id, role: 'user', content, timestamp: 1 }
}

function assistant(
  id: string,
  content: string,
  extra?: Partial<Message>,
): Message {
  return { id, role: 'assistant', content, timestamp: 1, ...extra }
}

describe('estimateTokensFromChars', () => {
  it('ceil-divides by 4', () => {
    expect(estimateTokensFromChars(0)).toBe(0)
    expect(estimateTokensFromChars(1)).toBe(1)
    expect(estimateTokensFromChars(4)).toBe(1)
    expect(estimateTokensFromChars(5)).toBe(2)
  })
})

describe('isSkillToolName', () => {
  it('detects skill tools', () => {
    expect(isSkillToolName('use_skill')).toBe(true)
    expect(isSkillToolName('Use_Skill')).toBe(true)
    expect(isSkillToolName('read_file')).toBe(false)
  })
})

describe('countVisibleContextChars', () => {
  it('splits user / assistant / skills / tools', () => {
    const messages: Message[] = [
      user('u1', 'hello'), // 5
      assistant('a1', 'world', {
        toolCalls: [
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'use_skill',
            input: 'skill-in', // 8
            output: 'skill-out', // 9
            status: 'finished',
            seq: 0,
          },
          {
            callId: 'c2',
            agentId: 'supervisor',
            name: 'read_file',
            input: 'path', // 4
            output: 'body', // 4
            status: 'finished',
            seq: 1,
          },
        ],
      }),
    ]
    expect(countVisibleContextChars(messages)).toEqual({
      user: 5,
      assistant: 5,
      skills: 17,
      tools: 8,
    })
  })
})

describe('estimateContextBreakdown', () => {
  it('puts remainder into other when under budget', () => {
    const messages = [user('u1', 'abcd')] // 4 chars → 1 token
    const segs = estimateContextBreakdown(messages, 100)
    const userSeg = segs.find((s) => s.key === 'user')
    const other = segs.find((s) => s.key === 'other')
    expect(userSeg?.tokens).toBe(1)
    expect(other?.tokens).toBe(99)
  })

  it('allocates system from systemPrompt (chars/4)', () => {
    // "sys!" = 4 chars → 1 token
    const segs = estimateContextBreakdown([user('u1', 'abcd')], 100, {
      systemPrompt: 'sys!',
    })
    expect(segs.find((s) => s.key === 'system')?.tokens).toBe(1)
    expect(segs.find((s) => s.key === 'user')?.tokens).toBe(1)
    expect(segs.find((s) => s.key === 'other')?.tokens).toBe(98)
  })

  it('prefers systemTokens over systemPrompt length', () => {
    const segs = estimateContextBreakdown([user('u1', 'abcd')], 100, {
      systemPrompt: 'x'.repeat(400),
      systemTokens: 3,
    })
    expect(segs.find((s) => s.key === 'system')?.tokens).toBe(3)
  })

  it('scales down when estimate exceeds budget', () => {
    const long = 'x'.repeat(400) // 100 tokens
    const messages = [user('u1', long), assistant('a1', long)]
    const segs = estimateContextBreakdown(messages, 50)
    const sum = segs.reduce((a, s) => a + s.tokens, 0)
    expect(sum).toBe(50)
  })

  it('returns empty for zero budget', () => {
    expect(estimateContextBreakdown([user('u1', 'hi')], 0)).toEqual([])
  })
})

describe('toCoarseContextBreakdown', () => {
  it('folds user+assistant into messages (Grok-aligned)', () => {
    const fine = estimateContextBreakdown(
      [user('u1', 'abcd'), assistant('a1', 'efgh')], // 1 + 1 tokens
      100,
      { systemPrompt: 'sys!' }, // 1 token
    )
    const coarse = toCoarseContextBreakdown(fine)
    expect(coarse.find((s) => s.key === 'system')?.tokens).toBe(1)
    expect(coarse.find((s) => s.key === 'messages')?.tokens).toBe(2)
    // Coarse keys never include fine-only `user` / `assistant`.
    expect(coarse.map((s) => s.key)).not.toContain('user')
    expect(coarse.map((s) => s.key)).not.toContain('assistant')
    expect(coarse.find((s) => s.key === 'other')?.tokens).toBe(97)
  })

  it('returns empty for empty input', () => {
    expect(toCoarseContextBreakdown([])).toEqual([])
  })
})

describe('selectLastUsage / inputBudgetFromUsage', () => {
  it('picks last usage message', () => {
    const messages: Message[] = [
      assistant('a1', 'x', { usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } }),
      user('u2', 'y'),
      assistant('a2', 'z', { usage: { inputTokens: 80, outputTokens: 5, totalTokens: 85 } }),
    ]
    expect(selectLastUsage(messages)?.inputTokens).toBe(80)
    expect(inputBudgetFromUsage(selectLastUsage(messages))).toBe(80)
  })

  it('does not treat billing total as budget when input is 0', () => {
    expect(
      inputBudgetFromUsage({ inputTokens: 0, outputTokens: 3, totalTokens: 10 }),
    ).toBeNull()
  })

  it('falls back to visible estimate when input is 0 and messages provided', () => {
    const body = 'word '.repeat(400)
    const messages: Message[] = [
      user('u1', body),
      assistant('a1', body, { usage: { inputTokens: 0, outputTokens: 3, totalTokens: 10 } }),
    ]
    const budget = inputBudgetFromUsage(selectLastUsage(messages), messages)
    expect(budget).toBeGreaterThan(100)
  })

  it('prefers contextTokens over summed inputTokens', () => {
    expect(
      inputBudgetFromUsage({
        inputTokens: 2_700_000,
        outputTokens: 6000,
        totalTokens: 2_706_000,
        contextTokens: 800_000,
      }),
    ).toBe(800_000)
  })
})
