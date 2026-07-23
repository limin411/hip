import { describe, expect, it } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { coalesceSystemMessages } from './anthropic-messages.js'

describe('coalesceSystemMessages', () => {
  it('is a no-op for a single leading system message', () => {
    const msgs = [new SystemMessage('sys'), new HumanMessage('hi'), new AIMessage('yo')]
    expect(coalesceSystemMessages(msgs)).toBe(msgs)
  })

  it('is a no-op when there are no system messages', () => {
    const msgs = [new HumanMessage('hi')]
    expect(coalesceSystemMessages(msgs)).toBe(msgs)
  })

  it('merges two leading systems into one (MiniMax planReminder case)', () => {
    const out = coalesceSystemMessages([
      new SystemMessage('main'),
      new SystemMessage('plan'),
      new HumanMessage('hi'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toBeInstanceOf(SystemMessage)
    expect(out[0].content).toBe('main\n\nplan')
    expect(out[1]).toBeInstanceOf(HumanMessage)
  })

  it('merges mid-conversation context SystemMessages (turn-2 session-context)', () => {
    const out = coalesceSystemMessages([
      new SystemMessage('main system'),
      new SystemMessage('context delta'),
      new HumanMessage('hi'),
      new AIMessage('hello'),
      new HumanMessage('really?'),
    ])
    expect(out).toHaveLength(4)
    expect(out[0]).toBeInstanceOf(SystemMessage)
    expect(String(out[0].content)).toContain('main system')
    expect(String(out[0].content)).toContain('context delta')
    expect(out.map((m) => m.getType())).toEqual(['system', 'human', 'ai', 'human'])
  })

  it('merges trailing max-steps SystemMessage into the leading system', () => {
    const out = coalesceSystemMessages([
      new SystemMessage('main'),
      new HumanMessage('hi'),
      new SystemMessage('max steps'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].content).toBe('main\n\nmax steps')
    expect(out[1]).toBeInstanceOf(HumanMessage)
  })
})
