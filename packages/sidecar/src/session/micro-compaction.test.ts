import { describe, it, expect, afterEach } from 'vitest'
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { MicroCompaction, isMicroCompactionEnabled } from './micro-compaction.js'

const STUB = '[Stale tool result cleared]'

/** Helper: create a ToolMessage with stable id and content. */
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

/** Helper: create an AIMessage with optional tool_calls. */
function ai(
  id: string,
  content: string,
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[],
): AIMessage {
  return new AIMessage({ id, content, ...(tool_calls ? { tool_calls: tool_calls as any } : {}) })
}

/** Helper: create a plain HumanMessage. */
function hu(id: string, content: string): HumanMessage {
  return new HumanMessage({ id, content })
}

// ── Feature gate tests ─────────────────────────────────────────────────

describe('isMicroCompactionEnabled', () => {
  afterEach(() => {
    delete process.env.HIP_EXPERIMENTAL_MICRO_COMPACTION
  })

  it('returns false when env var is not set', () => {
    expect(isMicroCompactionEnabled()).toBe(false)
  })

  it('returns true when env var is "1"', () => {
    process.env.HIP_EXPERIMENTAL_MICRO_COMPACTION = '1'
    expect(isMicroCompactionEnabled()).toBe(true)
  })

  it('returns true when env var is "true"', () => {
    process.env.HIP_EXPERIMENTAL_MICRO_COMPACTION = 'true'
    expect(isMicroCompactionEnabled()).toBe(true)
  })

  it('returns false for any other value', () => {
    process.env.HIP_EXPERIMENTAL_MICRO_COMPACTION = 'yes'
    expect(isMicroCompactionEnabled()).toBe(false)
  })
})

// ── MicroCompaction unit tests ─────────────────────────────────────────

describe('MicroCompaction', () => {
  it('truncates the 5 oldest stale tool results and preserves 20 recent messages', () => {
    // 30 messages, keepRecent=20 → staleThreshold=10, indices 0–9 are stale.
    // Build 5 oldest ToolMessages (0–4) that should be truncated.
    // Build an AIMessage at index 5 whose tool_call result lands in the
    // recent zone (index 12), creating a preserved range [5,9].
    // ToolMessages at 6–9 are stale but preserved.
    const messages: BaseMessage[] = [
      tm('tm0', 'old result 0'),
      tm('tm1', 'old result 1'),
      tm('tm2', 'old result 2'),
      tm('tm3', 'old result 3'),
      tm('tm4', 'old result 4'),
      ai('ai5', 'running a tool', [{ id: 'tc_boundary', name: 'search', args: {} }]),
      tm('tm6', 'result A', { tool_call_id: 'tc_a' }),
      tm('tm7', 'result B', { tool_call_id: 'tc_b' }),
      tm('tm8', 'result C', { tool_call_id: 'tc_c' }),
      tm('tm9', 'result D', { tool_call_id: 'tc_d' }),
      // Recent messages 10–29 (20 messages)
      hu('u10', 'recent user message'),
      ai('ai11', 'thinking'),
      tm('tm12', 'boundary result', { tool_call_id: 'tc_boundary' }), // the result in recent zone
      hu('u13', 'ok'),
      ...Array.from({ length: 16 }, (_, i) => hu(`u${14 + i}`, `msg ${14 + i}`)),
    ]

    const mc = new MicroCompaction({ keepRecent: 20 })
    const { messages: result, truncated } = mc.compact(messages)

    expect(truncated).toBe(5)

    // Oldest 5 truncated.
    for (let i = 0; i < 5; i++) {
      const m = result[i] as ToolMessage
      expect(m.content).toBe(STUB)
    }

    // Preserved stale ToolMessages (6–9).
    for (let i = 6; i <= 9; i++) {
      const m = result[i] as ToolMessage
      expect(m.content).not.toBe(STUB)
    }

    // Recent messages untouched.
    for (let i = 10; i < 30; i++) {
      const orig = messages[i]
      const res = result[i]
      if (orig instanceof ToolMessage) {
        expect((res as ToolMessage).content).toBe(
          (orig as ToolMessage).content,
        )
      }
    }
  })

  it('preserves messages in an unresolved tool exchange spanning the boundary', () => {
    // 30 messages, keepRecent=20, staleThreshold=10.
    // AIMessage at index 8 has a tool_call whose result (ToolMessage) is
    // at index 11 (recent). The range [8,9] is preserved.
    const messages: BaseMessage[] = [
      tm('tm0', 'result 0'),
      tm('tm1', 'result 1'),
      tm('tm2', 'result 2'),
      tm('tm3', 'result 3'),
      tm('tm4', 'result 4'),
      tm('tm5', 'result 5'),
      tm('tm6', 'result 6'),
      tm('tm7', 'result 7'),
      ai('ai8', 'tool call', [{ id: 'tc_span', name: 'run', args: {} }]),
      tm('tm9', 'result 9', { tool_call_id: 'tc_9' }),
      // Recent zone starts here (index 10+)
      tm('tm10', 'result 10', { tool_call_id: 'tc_10' }),
      tm('tm11', 'spanning result', { tool_call_id: 'tc_span' }),
      ...Array.from({ length: 18 }, (_, i) => hu(`u${12 + i}`, `msg ${12 + i}`)),
    ]

    const mc = new MicroCompaction({ keepRecent: 20 })
    const { messages: result, truncated } = mc.compact(messages)

    // Messages 0–7 are stale ToolMessages NOT in a preserved range → truncated.
    // That's 8 truncated.
    expect(truncated).toBe(8)
    for (let i = 0; i < 8; i++) {
      expect((result[i] as ToolMessage).content).toBe(STUB)
    }

    // AIMessage at index 8 unchanged (not a ToolMessage).
    expect((result[8] as AIMessage).content).toBe('tool call')

    // ToolMessage at index 9 is in preserved range [8,9] → NOT truncated.
    expect((result[9] as ToolMessage).content).toBe('result 9')

    // Recent messages (10+) untouched.
    expect((result[10] as ToolMessage).content).toBe('result 10')
    expect((result[11] as ToolMessage).content).toBe('spanning result')
  })

  it('does not truncate anything when all messages are within keepRecent', () => {
    const messages: BaseMessage[] = [
      tm('tm0', 'r0'),
      tm('tm1', 'r1'),
      tm('tm2', 'r2'),
      tm('tm3', 'r3'),
      tm('tm4', 'r4'),
      hu('u5', 'hello'),
      ai('ai6', 'reply'),
    ]

    const mc = new MicroCompaction({ keepRecent: 20 })
    const { messages: result, truncated } = mc.compact(messages)

    expect(truncated).toBe(0)
    // All messages exactly as they were (same content, same ids).
    for (let i = 0; i < messages.length; i++) {
      expect(result[i]).toBe(messages[i])
    }
  })

  it('preserves message IDs after truncation', () => {
    const messages: BaseMessage[] = [
      tm('tm0', 'old 0'),
      tm('tm1', 'old 1'),
      tm('tm2', 'old 2'),
      tm('tm3', 'old 3'),
      tm('tm4', 'old 4'),
      ai('ai5', 'text', [{ id: 'tc_x', name: 't', args: {} }]),
      tm('tm6', 'r6'),
      tm('tm7', 'r7'),
      tm('tm8', 'r8'),
      tm('tm9', 'r9'),
      tm('tm10', 'recent 10'),
      tm('tm11', 'recent X', { tool_call_id: 'tc_x' }),
      ...Array.from({ length: 18 }, (_, i) => hu(`u${12 + i}`, `m${12 + i}`)),
    ]

    const mc = new MicroCompaction({ keepRecent: 20 })
    const { messages: result } = mc.compact(messages)

    // Every message keeps its original id.
    for (let i = 0; i < messages.length; i++) {
      expect(result[i].id).toBe(messages[i].id)
    }
  })

  it('returns correct truncated count', () => {
    // 3 ToolMessages stale, all outside any preserved range.
    const messages: BaseMessage[] = [
      tm('tm0', 'a'),
      tm('tm1', 'b'),
      tm('tm2', 'c'),
      hu('u3', 'hello'),
      ai('ai4', 'reply'),
    ]

    const mc = new MicroCompaction({ keepRecent: 3 })
    // staleThreshold = 5 - 3 = 2 → indices 0,1 are stale
    const { truncated } = mc.compact(messages)
    expect(truncated).toBe(2)
  })

  it('does not truncate stale ToolMessages referenced by a recent AIMessage', () => {
    // Phase 2: a recent AIMessage (index >= staleThreshold) has a
    // tool_call whose matching ToolMessage is stale → preserve it.
    const messages: BaseMessage[] = [
      tm('tm0', 'stale result', { tool_call_id: 'tc_ref' }),
      tm('tm1', 'other stale'),
      hu('u2', 'recent user'),
      ai('ai3', 'using tool', [{ id: 'tc_ref', name: 'lookup', args: {} }]),
    ]

    const mc = new MicroCompaction({ keepRecent: 2 })
    // staleThreshold = 4 - 2 = 2 → indices 0,1 are stale
    // tm0 matches 'tc_ref' which is referenced by AIMessage at index 3 (recent) → preserved
    // tm1 has no recent reference → truncated
    const { messages: result, truncated } = mc.compact(messages)

    expect(truncated).toBe(1)
    expect((result[0] as ToolMessage).content).toBe('stale result') // preserved
    expect((result[1] as ToolMessage).content).toBe(STUB) // truncated
  })

  it('preserves ToolMessages that are part of a resolved exchange within recent window', () => {
    // When a stale AIMessage's tool_call has a result in the recent zone,
    // the entire range from that AIMessage to staleThreshold is preserved,
    // including non-ToolMessages and ToolMessages alike.
    const messages: BaseMessage[] = [
      tm('tm0', 'r0'),
      tm('tm1', 'r1'),
      tm('tm2', 'r2'),
      tm('tm3', 'r3'),
      tm('tm4', 'r4'),
      ai('ai5', 'calling', [{ id: 'tc_recent_result', name: 'do', args: {} }]),
      tm('tm6', 'preserved 6', { tool_call_id: 'tc_a' }),
      tm('tm7', 'preserved 7', { tool_call_id: 'tc_b' }),
      tm('tm8', 'preserved 8', { tool_call_id: 'tc_c' }),
      tm('tm9', 'preserved 9', { tool_call_id: 'tc_d' }),
      hu('u10', 'recent user'),
      tm('tm11', 'recent result', { tool_call_id: 'tc_recent_result' }),
      ...Array.from({ length: 18 }, (_, i) => hu(`u${12 + i}`, `m${12 + i}`)),
    ]

    const mc = new MicroCompaction({ keepRecent: 20 })
    const { messages: result, truncated } = mc.compact(messages)

    // Indices 0-4: 5 ToolMessages, all stale and outside preserved range → truncated.
    expect(truncated).toBe(5)

    // Indices 6-9: stale ToolMessages but in preserved range [5,9] → NOT truncated.
    for (let i = 6; i <= 9; i++) {
      expect((result[i] as ToolMessage).content).not.toBe(STUB)
    }

    // Index 11: recent ToolMessage, untouched.
    expect((result[11] as ToolMessage).content).toBe('recent result')
  })
})
