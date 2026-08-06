import { describe, it, expect } from 'vitest'
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import {
  softTrimMessages,
  softTrimText,
  isSoftTrimEnabled,
  isSoftTrimSkipContent,
  SOFT_TRIM_MARKER,
  DEFAULT_SOFT_TRIM_PERCENT,
} from './soft-trim.js'

function tm(
  id: string,
  content: string,
  opts?: { tool_call_id?: string; name?: string },
): ToolMessage {
  return new ToolMessage({
    id,
    content,
    tool_call_id: opts?.tool_call_id ?? `tc_${id}`,
    name: opts?.name ?? 'test_tool',
  })
}

function hu(id: string, content: string): HumanMessage {
  return new HumanMessage({ id, content })
}

function ai(id: string, content: string): AIMessage {
  return new AIMessage({ id, content })
}

/** Long body that exceeds default head+tail+marker. */
function longBody(n = 8000): string {
  return 'A'.repeat(n)
}

describe('isSoftTrimEnabled', () => {
  it('is disabled by default', () => {
    expect(isSoftTrimEnabled()).toBe(false)
    expect(isSoftTrimEnabled({})).toBe(false)
    expect(isSoftTrimEnabled({ enabled: false })).toBe(false)
    expect(isSoftTrimEnabled(null)).toBe(false)
  })

  it('is true only when enabled: true', () => {
    expect(isSoftTrimEnabled({ enabled: true })).toBe(true)
  })
})

describe('softTrimText', () => {
  it('returns short strings unchanged', () => {
    expect(softTrimText('hello', 10, 10)).toBe('hello')
  })

  it('head+tail truncates long strings', () => {
    const body = longBody(5000)
    const out = softTrimText(body, 100, 100)
    expect(out.startsWith('A'.repeat(100))).toBe(true)
    expect(out.endsWith('A'.repeat(100))).toBe(true)
    expect(out).toContain(SOFT_TRIM_MARKER)
    expect(out.length).toBe(100 + SOFT_TRIM_MARKER.length + 100)
  })
})

describe('softTrimMessages', () => {
  it('is a no-op when disabled (default)', () => {
    const messages: BaseMessage[] = [
      hu('u0', 'old'),
      tm('t0', longBody()),
      hu('u1', 'mid'),
      tm('t1', longBody()),
      hu('u2', 'new'),
      tm('t2', longBody()),
      hu('u3', 'latest'),
    ]
    const { messages: out, trimmed } = softTrimMessages(messages)
    expect(trimmed).toBe(0)
    expect(out).toBe(messages)
    expect((out[1] as ToolMessage).content).toBe(longBody())
  })

  it('is a no-op when fill is at or below threshold', () => {
    const messages: BaseMessage[] = [
      hu('u0', 'old'),
      tm('t0', longBody()),
      hu('u1', 'a'),
      hu('u2', 'b'),
      hu('u3', 'c'),
    ]
    const { trimmed } = softTrimMessages(messages, {
      enabled: true,
      fillPercent: DEFAULT_SOFT_TRIM_PERCENT,
      softTrimPercent: 50,
      keepLastNTurns: 2,
    })
    expect(trimmed).toBe(0)

    const low = softTrimMessages(messages, {
      enabled: true,
      fillPercent: 40,
      softTrimPercent: 50,
      keepLastNTurns: 2,
    })
    expect(low.trimmed).toBe(0)
  })

  it('when enabled and fill above threshold, trims old long tool bodies', () => {
    const oldBody = longBody(9000)
    const recentBody = longBody(9000)
    const messages: BaseMessage[] = [
      hu('u0', 'turn0'),
      ai('a0', 'calling'),
      tm('t0', oldBody),
      hu('u1', 'turn1'),
      tm('t1', oldBody),
      hu('u2', 'turn2'),
      tm('t2', recentBody),
      hu('u3', 'turn3'),
      tm('t3', recentBody),
    ]
    // keepLastNTurns=2 → keep from hu('u2'); t0 and t1 are stale candidates
    const { messages: out, trimmed } = softTrimMessages(messages, {
      enabled: true,
      fillPercent: 60,
      softTrimPercent: 50,
      keepLastNTurns: 2,
      headChars: 50,
      tailChars: 50,
    })

    expect(trimmed).toBe(2)
    expect(out).not.toBe(messages)

    const t0 = out[2] as ToolMessage
    expect(t0.content).toContain(SOFT_TRIM_MARKER)
    expect(t0.content.length).toBeLessThan(oldBody.length)
    expect(t0.content.startsWith('A'.repeat(50))).toBe(true)

    const t1 = out[4] as ToolMessage
    expect(t1.content).toContain(SOFT_TRIM_MARKER)

    // Recent turns untouched
    expect((out[6] as ToolMessage).content).toBe(recentBody)
    expect((out[8] as ToolMessage).content).toBe(recentBody)

    // Originals not mutated
    expect((messages[2] as ToolMessage).content).toBe(oldBody)
    expect((messages[4] as ToolMessage).content).toBe(oldBody)
  })

  it('skips short tool bodies and hard-clear stubs', () => {
    const messages: BaseMessage[] = [
      hu('u0', 'old'),
      tm('t0', 'short'),
      tm('t1', '[Old tool result cleared] | name=x | chars=9'),
      tm('t2', longBody()),
      hu('u1', 'a'),
      hu('u2', 'b'),
      hu('u3', 'c'),
    ]
    const { messages: out, trimmed } = softTrimMessages(messages, {
      enabled: true,
      fillPercent: 80,
      keepLastNTurns: 2,
      headChars: 50,
      tailChars: 50,
    })
    expect(trimmed).toBe(1)
    expect((out[1] as ToolMessage).content).toBe('short')
    expect((out[2] as ToolMessage).content).toContain('[Old tool result cleared]')
    expect((out[3] as ToolMessage).content).toContain(SOFT_TRIM_MARKER)
  })

  it('does not trim when keepLastNTurns covers all human turns', () => {
    const messages: BaseMessage[] = [
      hu('u0', 'a'),
      tm('t0', longBody()),
      hu('u1', 'b'),
      tm('t1', longBody()),
    ]
    const { trimmed, messages: out } = softTrimMessages(messages, {
      enabled: true,
      fillPercent: 90,
      keepLastNTurns: 3,
    })
    expect(trimmed).toBe(0)
    expect(out).toBe(messages)
  })
})

describe('isSoftTrimSkipContent', () => {
  it('detects hard-clear and soft-trim markers', () => {
    expect(isSoftTrimSkipContent('[Old tool result cleared] x')).toBe(true)
    expect(isSoftTrimSkipContent('[Stale tool result cleared]')).toBe(true)
    expect(isSoftTrimSkipContent(`head${SOFT_TRIM_MARKER}tail`)).toBe(true)
    expect(isSoftTrimSkipContent('normal tool output')).toBe(false)
  })
})
