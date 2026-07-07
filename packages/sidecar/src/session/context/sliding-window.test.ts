import { describe, it, expect } from 'vitest'
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { applySlidingWindow } from './sliding-window.js'

describe('applySlidingWindow', () => {
  it('returns all messages when under maxMessages limit', () => {
    const msgs: BaseMessage[] = [
      new HumanMessage('task'),
      new AIMessage('response'),
    ]
    const result = applySlidingWindow(msgs, { maxMessages: 10 })
    expect(result.kept).toHaveLength(2)
    expect(result.removed).toHaveLength(0)
    expect(result.kept[0].content).toBe('task')
    expect(result.kept[1].content).toBe('response')
  })

  it('preserves first human message + last N turns when over limit', () => {
    // Build 8 messages: [H0, A0, H1, A1, H2, A2, H3, A3]
    const msgs: BaseMessage[] = []
    for (let i = 0; i < 4; i++) {
      msgs.push(new HumanMessage({ id: `h${i}`, content: `Human ${i}` }))
      msgs.push(new AIMessage({ id: `a${i}`, content: `AI ${i}` }))
    }

    // maxMessages=5, recentTurns=2
    const result = applySlidingWindow(msgs, { maxMessages: 5, recentTurns: 2 })

    // Expected: keep H0 (first human) + last 2 turns [H2, A2, H3, A3]
    // Remove: [A0, H1, A1] (the middle turn)
    expect(result.kept).toHaveLength(5)
    expect(result.kept[0].id).toBe('h0')
    expect(result.kept[1].id).toBe('h2')
    expect(result.kept[2].id).toBe('a2')
    expect(result.kept[3].id).toBe('h3')
    expect(result.kept[4].id).toBe('a3')

    expect(result.removed).toHaveLength(3)
    expect(result.removed[0].id).toBe('a0')
    expect(result.removed[1].id).toBe('h1')
    expect(result.removed[2].id).toBe('a1')
  })

  it('does not preserve first message when preserveFirstMessage is false', () => {
    const msgs: BaseMessage[] = [
      new HumanMessage({ id: 'h0', content: 'task' }),
      new AIMessage({ id: 'a0', content: 'resp' }),
      new HumanMessage({ id: 'h1', content: 'q2' }),
      new AIMessage({ id: 'a1', content: 'a2' }),
    ]

    const result = applySlidingWindow(msgs, { maxMessages: 2, recentTurns: 1, preserveFirstMessage: false })

    // Expected: keep only last turn [H1, A1], remove first turn [H0, A0]
    expect(result.kept).toHaveLength(2)
    expect(result.kept[0].id).toBe('h1')
    expect(result.kept[1].id).toBe('a1')

    expect(result.removed).toHaveLength(2)
    expect(result.removed[0].id).toBe('h0')
    expect(result.removed[1].id).toBe('a0')
  })

  it('handles empty messages array', () => {
    const result = applySlidingWindow([])
    expect(result.kept).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
  })

  it('handles messages with no human messages at all', () => {
    const msgs: BaseMessage[] = [
      new SystemMessage('system'),
      new AIMessage('ai only'),
    ]
    const result = applySlidingWindow(msgs, { maxMessages: 0 })

    // No human → preserveFirstMessage has no effect (msg[0] is SystemMessage)
    // Everything becomes one non-human turn
    expect(result.kept).toHaveLength(2)
    expect(result.removed).toHaveLength(0)
  })

  it('keeps all turns when number of turns is less than recentTurns', () => {
    const msgs: BaseMessage[] = [
      new HumanMessage({ id: 'h0', content: 'hi' }),
      new AIMessage({ id: 'a0', content: 'hello' }),
    ]

    const result = applySlidingWindow(msgs, { maxMessages: 0, recentTurns: 10 })
    expect(result.kept).toHaveLength(2)
    expect(result.removed).toHaveLength(0)
  })

  it('works with ToolMessages and SystemMessages interleaved', () => {
    const msgs: BaseMessage[] = [
      new HumanMessage({ id: 'h0', content: 'task' }),
      new AIMessage({ id: 'a0', content: '', tool_calls: [{ name: 'read', args: {}, id: 'tc1' }] }),
      new ToolMessage({ id: 't0', content: 'file content', tool_call_id: 'tc1', name: 'read' }),
      new AIMessage({ id: 'a1', content: 'Here is the result' }),
      new HumanMessage({ id: 'h1', content: 'follow up' }),
      new AIMessage({ id: 'a2', content: 'reply' }),
    ]

    const result = applySlidingWindow(msgs, { maxMessages: 3, recentTurns: 1 })

    // Expected: keep H0 + last turn [H1, A2], remove middle [A0, T0, A1]
    expect(result.kept).toHaveLength(3)
    expect(result.kept[0].id).toBe('h0')
    expect(result.kept[1].id).toBe('h1')
    expect(result.kept[2].id).toBe('a2')

    expect(result.removed).toHaveLength(3)
    expect(result.removed[0].id).toBe('a0')
    expect(result.removed[1].id).toBe('t0')
    expect(result.removed[2].id).toBe('a1')
  })

  it('uses defaults for recentTurns and maxMessages', () => {
    // Create 60 messages (above default maxMessages=50)
    const msgs: BaseMessage[] = []
    for (let i = 0; i < 30; i++) {
      msgs.push(new HumanMessage({ id: `h${i}`, content: `Q${i}` }))
      msgs.push(new AIMessage({ id: `a${i}`, content: `A${i}` }))
    }

    const result = applySlidingWindow(msgs)

    // 60 > 50 → sliding window activated
    expect(result.removed.length).toBeGreaterThan(0)

    // Keep: H0 + last 5 turns (10 messages) + H0 itself = 11 kept
    // Rest removed: 60 - 11 = 49 removed
    expect(result.kept[0].id).toBe('h0')
    expect(result.removed.length).toBe(49)
    expect(result.kept.length).toBe(11)
  })

  it('preserves order of kept messages', () => {
    const msgs: BaseMessage[] = [
      new HumanMessage({ id: 'h0', content: 'start' }),
      new AIMessage({ id: 'a0', content: 'resp0' }),
      new HumanMessage({ id: 'h1', content: 'mid' }),
      new AIMessage({ id: 'a1', content: 'resp1' }),
      new HumanMessage({ id: 'h2', content: 'latest' }),
      new AIMessage({ id: 'a2', content: 'resp2' }),
    ]

    const result = applySlidingWindow(msgs, { maxMessages: 3, recentTurns: 1 })

    // Order in kept should be: h0, h2, a2
    expect(result.kept.map((m) => m.id)).toEqual(['h0', 'h2', 'a2'])
  })
})
