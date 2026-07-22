import { describe, it, expect } from 'vitest'
import type { Message } from '@hip/protocol'
import {
  estimateTokensFromChars,
  estimateContextBreakdown,
  isSkillToolName,
  countVisibleContextChars,
  selectLastUsage,
  inputBudgetFromUsage,
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

  it('falls back when input is 0', () => {
    expect(
      inputBudgetFromUsage({ inputTokens: 0, outputTokens: 3, totalTokens: 10 }),
    ).toBe(10)
  })
})
