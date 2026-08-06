import { describe, it, expect, afterEach } from 'vitest'
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import {
  MicroCompaction,
  isMicroCompactionEnabled,
  isSkillToolName,
  PRUNE_PROTECT_TOKENS,
  PRUNE_MINIMUM_TOKENS,
} from './micro-compaction.js'
import { isSkillToolName as protocolIsSkillToolName } from '@hip/protocol'

const STUB = '[Old tool result cleared]'

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
    delete process.env.HIP_COMPACTION_PRUNE
  })

  it('returns true by default (prune on)', () => {
    expect(isMicroCompactionEnabled()).toBe(true)
  })

  it('returns false when HIP_COMPACTION_PRUNE=0', () => {
    process.env.HIP_COMPACTION_PRUNE = '0'
    expect(isMicroCompactionEnabled()).toBe(false)
  })

  it('returns false when HIP_COMPACTION_PRUNE=false', () => {
    process.env.HIP_COMPACTION_PRUNE = 'false'
    expect(isMicroCompactionEnabled()).toBe(false)
  })

  it('returns true when HIP_COMPACTION_PRUNE is unset', () => {
    delete process.env.HIP_COMPACTION_PRUNE
    expect(isMicroCompactionEnabled()).toBe(true)
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
      expect(String(m.content).startsWith(STUB)).toBe(true)
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
      expect(String((result[i] as ToolMessage).content).startsWith(STUB)).toBe(true)
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
    expect(String((result[1] as ToolMessage).content).startsWith(STUB)).toBe(true) // truncated
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

// ── Token protect window + precedence (PR-5 / KD-7 / KD-17) ────────────

/** Build a string that estimates to roughly `tokens` via chars/4. */
function blob(tokens: number, tag = 'x'): string {
  // ceil(len/4) === tokens ⇒ len in ((tokens-1)*4, tokens*4]
  return tag.repeat(Math.max(1, tokens * 4))
}

describe('isSkillToolName (shared)', () => {
  it('matches protocol helper', () => {
    for (const n of ['use_skill', 'skill', 'SkillLoader', 'read_file', 'bash']) {
      expect(isSkillToolName(n)).toBe(protocolIsSkillToolName(n))
    }
  })

  it('detects skill tools case-insensitively', () => {
    expect(isSkillToolName('use_skill')).toBe(true)
    expect(isSkillToolName('Use_Skill')).toBe(true)
    expect(isSkillToolName('skill')).toBe(true)
    expect(isSkillToolName('my_skill_tool')).toBe(true)
    expect(isSkillToolName('read_file')).toBe(false)
  })
})

describe('MicroCompaction token window', () => {
  it('exports OpenCode-aligned defaults', () => {
    expect(PRUNE_PROTECT_TOKENS).toBe(40_000)
    expect(PRUNE_MINIMUM_TOKENS).toBe(20_000)
  })

  it('protects newest tool results within pruneProtectTokens (newest→oldest)', () => {
    // 3 tool results: oldest 30k tokens, mid 30k, newest 30k.
    // protect=40k → newest (30k) protected; mid pushes total to 60k → candidate;
    // oldest also candidate. Candidate volume = 60k > minimum 1 → prune mid+old.
    const messages: BaseMessage[] = [
      tm('old', blob(30_000, 'o'), { name: 'bash' }),
      tm('mid', blob(30_000, 'm'), { name: 'bash' }),
      tm('new', blob(30_000, 'n'), { name: 'bash' }),
    ]

    const mc = new MicroCompaction({
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 1,
    })
    const { messages: result, truncated } = mc.compact(messages)

    expect(truncated).toBe(2)
    expect(String((result[0] as ToolMessage).content).startsWith(STUB)).toBe(true)
    expect(String((result[1] as ToolMessage).content).startsWith(STUB)).toBe(true)
    expect((result[2] as ToolMessage).content).toBe(blob(30_000, 'n'))
  })

  it('skips prune when candidate volume ≤ pruneMinimumTokens', () => {
    // Same layout as above but minimum larger than candidate release.
    // protect=40k → candidates mid+old = 60k tokens; set minimum to 100k → no prune.
    const messages: BaseMessage[] = [
      tm('old', blob(30_000, 'o'), { name: 'bash' }),
      tm('mid', blob(30_000, 'm'), { name: 'bash' }),
      tm('new', blob(30_000, 'n'), { name: 'bash' }),
    ]

    const mc = new MicroCompaction({
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 100_000,
    })
    const { messages: result, truncated } = mc.compact(messages)

    expect(truncated).toBe(0)
    expect(result[0]).toBe(messages[0])
    expect(result[1]).toBe(messages[1])
    expect(result[2]).toBe(messages[2])
  })

  it('skips prune when candidate volume equals pruneMinimumTokens (strict >)', () => {
    // protect=10 → newest 10 tokens protected; older 20 tokens is sole candidate.
    // minimum=20 → 20 <= 20 → skip (OpenCode: pruned > PRUNE_MINIMUM).
    const messages: BaseMessage[] = [
      tm('old', blob(20, 'o'), { name: 'bash' }),
      tm('new', blob(10, 'n'), { name: 'bash' }),
    ]
    const mc = new MicroCompaction({
      pruneProtectTokens: 10,
      pruneMinimumTokens: 20,
    })
    expect(mc.compact(messages).truncated).toBe(0)

    const mc2 = new MicroCompaction({
      pruneProtectTokens: 10,
      pruneMinimumTokens: 19,
    })
    expect(mc2.compact(messages).truncated).toBe(1)
  })

  it('does not prune when all tool output fits in protect window', () => {
    const messages: BaseMessage[] = [
      tm('a', blob(100, 'a'), { name: 'bash' }),
      tm('b', blob(100, 'b'), { name: 'bash' }),
      hu('u', 'hi'),
    ]
    const mc = new MicroCompaction({
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 1,
    })
    expect(mc.compact(messages).truncated).toBe(0)
  })
})

describe('MicroCompaction precedence (pair > skill > token window)', () => {
  it('never prunes skill tools even outside the token protect window', () => {
    // Newest non-skill fills protect budget; older skill must still be kept.
    const messages: BaseMessage[] = [
      tm('skill_old', blob(5_000, 's'), { name: 'use_skill', tool_call_id: 'tc_skill' }),
      tm('old_bash', blob(30_000, 'o'), { name: 'bash', tool_call_id: 'tc_old' }),
      tm('new_bash', blob(30_000, 'n'), { name: 'bash', tool_call_id: 'tc_new' }),
    ]

    const mc = new MicroCompaction({
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 1,
    })
    const { messages: result, truncated } = mc.compact(messages)

    // new_bash (30k) protected; old_bash candidate; skill always protected.
    expect(truncated).toBe(1)
    expect((result[0] as ToolMessage).content).toBe(blob(5_000, 's'))
    expect(String((result[1] as ToolMessage).content).startsWith(STUB)).toBe(true)
    expect((result[2] as ToolMessage).content).toBe(blob(30_000, 'n'))
  })

  it('skill tools do not consume the protect token budget', () => {
    // Newest is skill (ignored for budget); next non-skill should still be protected.
    const messages: BaseMessage[] = [
      tm('old', blob(50, 'o'), { name: 'bash' }),
      tm('skill', blob(100, 's'), { name: 'use_skill' }),
      tm('mid', blob(30, 'm'), { name: 'bash' }),
    ]
    // protect=40 → mid (30) protected; skill skipped in budget; old (50) pushes past → candidate.
    const mc = new MicroCompaction({
      pruneProtectTokens: 40,
      pruneMinimumTokens: 1,
    })
    const { messages: result, truncated } = mc.compact(messages)
    expect(truncated).toBe(1)
    expect(String((result[0] as ToolMessage).content).startsWith(STUB)).toBe(true)
    expect((result[1] as ToolMessage).content).toBe(blob(100, 's'))
    expect((result[2] as ToolMessage).content).toBe(blob(30, 'm'))
  })

  it('unresolved tool-pair outranks token window (preserves span into protect zone)', () => {
    // AIMessage + intermediate tool outside protect; matching result inside protect.
    // Pair phase must preserve the intermediate tool even though it is outside the window.
    const messages: BaseMessage[] = [
      tm('noise', blob(50, 'z'), { name: 'bash', tool_call_id: 'tc_noise' }),
      ai('ai_call', 'run', [{ id: 'tc_span', name: 'search', args: {} }]),
      tm('mid_other', blob(50, 'm'), { name: 'bash', tool_call_id: 'tc_mid' }),
      tm('span_result', blob(20, 'r'), { name: 'bash', tool_call_id: 'tc_span' }),
    ]
    // protect=20 → only span_result token-protected; noise+mid candidates by age,
    // but mid is in pair-preserved range [ai_call, recentStart).
    const mc = new MicroCompaction({
      pruneProtectTokens: 20,
      pruneMinimumTokens: 1,
    })
    const { messages: result, truncated } = mc.compact(messages)

    expect(String((result[0] as ToolMessage).content).startsWith(STUB)).toBe(true)
    expect((result[2] as ToolMessage).content).toBe(blob(50, 'm')) // pair-preserved
    expect((result[3] as ToolMessage).content).toBe(blob(20, 'r')) // token-protected
    expect(truncated).toBe(1)
  })

  it('pair reference from recent AIMessage protects stale tool result (phase 2)', () => {
    const messages: BaseMessage[] = [
      tm('stale', blob(50, 's'), { name: 'bash', tool_call_id: 'tc_ref' }),
      tm('other', blob(50, 'o'), { name: 'bash', tool_call_id: 'tc_other' }),
      tm('recent', blob(10, 'r'), { name: 'bash', tool_call_id: 'tc_r' }),
      ai('ai', 'use', [{ id: 'tc_ref', name: 'lookup', args: {} }]),
    ]
    // protect=10 → only `recent` in token window; recentStart at that tool.
    // AI after recentStart references tc_ref → stale preserved; other pruned.
    const mc = new MicroCompaction({
      pruneProtectTokens: 10,
      pruneMinimumTokens: 1,
    })
    const { messages: result, truncated } = mc.compact(messages)
    expect(truncated).toBe(1)
    expect((result[0] as ToolMessage).content).toBe(blob(50, 's'))
    expect(String((result[1] as ToolMessage).content).startsWith(STUB)).toBe(true)
    expect((result[2] as ToolMessage).content).toBe(blob(10, 'r'))
  })

  it('honors config-sized protect/minimum from opts (ContextConfig wiring)', () => {
    const messages: BaseMessage[] = [
      tm('old', blob(100, 'o'), { name: 'bash' }),
      tm('new', blob(40, 'n'), { name: 'bash' }),
    ]
    // Mimic resolveContextPolicy({ pruneProtectTokens: 40, pruneMinimumTokens: 50 })
    const mc = new MicroCompaction({
      pruneProtectTokens: 40,
      pruneMinimumTokens: 50,
    })
    // candidate old=100 > 50 → prune
    expect(mc.compact(messages).truncated).toBe(1)

    const mcHighMin = new MicroCompaction({
      pruneProtectTokens: 40,
      pruneMinimumTokens: 200,
    })
    expect(mcHighMin.compact(messages).truncated).toBe(0)
  })
})

