import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import {
  PrefireCache,
  fingerprintMessages,
  shouldStartPrefire,
  isTwoPassPrefireEnabled,
  PREFIRE_LEAD_PERCENT,
} from './prefire.js'
import type { Summarizer } from './compaction.js'
import { compactMessages, selectCompactMiddle } from './compaction.js'

const longSummary = 'NOTE1 prefire summary: ' + 'critical facts and paths. '.repeat(8)

function makeMiddle(n: number): BaseMessage[] {
  const out: BaseMessage[] = []
  for (let i = 0; i < n; i++) {
    // ~1k chars per message so n≥4 exceeds PREFIRE_MIN_MIDDLE_TOKENS (~800).
    out.push(new AIMessage({ id: `a${i}`, content: `mid reply ${i} ` + 'x'.repeat(1000) }))
    out.push(new HumanMessage({ id: `u${i}`, content: `mid ask ${i} ` + 'y'.repeat(1000) }))
  }
  return out
}

describe('shouldStartPrefire', () => {
  it('fires between (threshold − lead) and threshold', () => {
    const cw = 100_000
    // 75% with lead 10 and threshold 85
    expect(shouldStartPrefire(75_000, cw, 85, 10)).toBe(true)
    expect(shouldStartPrefire(74_999, cw, 85, 10)).toBe(false)
    // At full threshold, prefire should NOT start (compact owns it)
    expect(shouldStartPrefire(85_000, cw, 85, 10)).toBe(false)
  })

  it('KD-16: allowOverBudget still starts prefire when over compact threshold', () => {
    const cw = 100_000
    expect(shouldStartPrefire(85_000, cw, 85, 10)).toBe(false)
    expect(shouldStartPrefire(85_000, cw, 85, 10, { allowOverBudget: true })).toBe(true)
    expect(shouldStartPrefire(99_000, cw, 85, 10, { allowOverBudget: true })).toBe(true)
    // Still require prefire band when not over compact threshold and not allowOverBudget
    expect(shouldStartPrefire(70_000, cw, 85, 10, { allowOverBudget: true })).toBe(false)
  })

  it('PREFIRE_LEAD_PERCENT default is 10', () => {
    expect(PREFIRE_LEAD_PERCENT).toBe(10)
  })
})

describe('fingerprintMessages', () => {
  it('is stable for same content and changes when content changes', () => {
    const a = [new HumanMessage({ id: 'u1', content: 'hello' })]
    const b = [new HumanMessage({ id: 'u1', content: 'hello' })]
    const c = [new HumanMessage({ id: 'u1', content: 'hello!' })]
    expect(fingerprintMessages(a)).toBe(fingerprintMessages(b))
    expect(fingerprintMessages(a)).not.toBe(fingerprintMessages(c))
  })
})

describe('PrefireCache', () => {
  const prev = process.env.HIP_TWO_PASS_COMPACT
  beforeEach(() => {
    delete process.env.HIP_TWO_PASS_COMPACT
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.HIP_TWO_PASS_COMPACT
    else process.env.HIP_TWO_PASS_COMPACT = prev
  })

  it('isTwoPassPrefireEnabled respects env kill switch', () => {
    process.env.HIP_TWO_PASS_COMPACT = '0'
    expect(isTwoPassPrefireEnabled()).toBe(false)
    delete process.env.HIP_TWO_PASS_COMPACT
    expect(isTwoPassPrefireEnabled()).toBe(true)
  })

  it('startPass1 stores NOTE₁ and match returns it for the same middle', async () => {
    const cache = new PrefireCache()
    const middle = makeMiddle(4)
    const summarizer: Summarizer = {
      async summarize() {
        return longSummary
      },
    }
    expect(cache.startPass1(middle, summarizer)).toBe('started')
    await cache.awaitInflight(5_000)
    const hit = cache.match(middle)
    expect(hit).not.toBeNull()
    expect(hit!.note1).toContain('NOTE1')
    expect(hit!.delta).toHaveLength(0)
  })

  it('match returns delta when middle grew after prefire', async () => {
    const cache = new PrefireCache()
    const middle = makeMiddle(4)
    const summarizer: Summarizer = { async summarize() { return longSummary } }
    cache.startPass1(middle, summarizer)
    await cache.awaitInflight(5_000)
    const grown = [
      ...middle,
      new AIMessage({ id: 'extra', content: 'new work after prefire ' + 'z'.repeat(100) }),
    ]
    const hit = cache.match(grown)
    expect(hit).not.toBeNull()
    expect(hit!.delta).toHaveLength(1)
    expect(hit!.delta[0].id).toBe('extra')
  })

  it('invalidates when prefix content changes', async () => {
    const cache = new PrefireCache()
    const middle = makeMiddle(4)
    const summarizer: Summarizer = { async summarize() { return longSummary } }
    cache.startPass1(middle, summarizer)
    await cache.awaitInflight(5_000)
    const mutated = [...middle]
    mutated[0] = new AIMessage({ id: 'a0', content: 'CHANGED ' + 'x'.repeat(200) })
    expect(cache.match(mutated)).toBeNull()
  })

  it('skips tiny middles', () => {
    const cache = new PrefireCache()
    const tiny = [new HumanMessage({ id: 'u', content: 'hi' })]
    const summarizer: Summarizer = { async summarize() { return longSummary } }
    expect(cache.startPass1(tiny, summarizer)).toBe('skipped_small')
  })
})

describe('compactMessages with prefire', () => {
  it('reuses NOTE₁ without a second summarize when delta is empty', async () => {
    const cache = new PrefireCache()
    let summarizeCalls = 0
    const summarizer: Summarizer = {
      async summarize() {
        summarizeCalls++
        return longSummary
      },
    }

    // Build a multi-turn conversation large enough to have a middle.
    const messages: BaseMessage[] = [
      new HumanMessage({ id: 'u0', content: 'goal ' + 'g'.repeat(50) }),
    ]
    for (let i = 1; i <= 8; i++) {
      messages.push(new AIMessage({ id: `a${i}`, content: `reply ${i} ` + 'r'.repeat(400) }))
      messages.push(new HumanMessage({ id: `u${i}`, content: `ask ${i} ` + 'q'.repeat(400) }))
    }

    const plan = selectCompactMiddle(messages, { keepRecentTurns: 2 })
    expect(plan).not.toBeNull()
    expect(cache.startPass1(plan!.middle, summarizer)).toBe('started')
    await cache.awaitInflight(5_000)
    const pass1Calls = summarizeCalls
    expect(pass1Calls).toBeGreaterThanOrEqual(1)

    const result = await compactMessages(messages, {
      keepRecentTurns: 2,
      summarizer,
      prefire: cache,
    })
    expect(result).not.toBeNull()
    // No extra summarize when delta empty (quality gate on pure NOTE₁ path is skipped)
    expect(summarizeCalls).toBe(pass1Calls)
    const content = typeof result!.summary.content === 'string' ? result!.summary.content : ''
    expect(content).toContain('NOTE1')
  })

  it('runs pass-2 when middle grew after prefire', async () => {
    const cache = new PrefireCache()
    let summarizeCalls = 0
    const summarizer: Summarizer = {
      async summarize(msgs) {
        summarizeCalls++
        const joined = msgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ')
        if (joined.includes('NOTE₁') || joined.includes('NOTE1')) {
          return 'NOTE2 merged summary: ' + 'updated. '.repeat(20)
        }
        return longSummary
      },
    }

    const messages: BaseMessage[] = [
      new HumanMessage({ id: 'u0', content: 'goal ' + 'g'.repeat(50) }),
    ]
    for (let i = 1; i <= 8; i++) {
      messages.push(new AIMessage({ id: `a${i}`, content: `reply ${i} ` + 'r'.repeat(400) }))
      messages.push(new HumanMessage({ id: `u${i}`, content: `ask ${i} ` + 'q'.repeat(400) }))
    }

    const plan = selectCompactMiddle(messages, { keepRecentTurns: 2 })
    expect(plan).not.toBeNull()
    cache.startPass1(plan!.middle, summarizer)
    await cache.awaitInflight(5_000)

    // Grow history so middle gains a delta while keep still leaves room.
    messages.splice(
      messages.length - 2,
      0,
      new AIMessage({ id: 'extra-a', content: 'extra mid ' + 'e'.repeat(100) }),
      new HumanMessage({ id: 'extra-u', content: 'extra q ' + 'e'.repeat(100) }),
    )

    const before = summarizeCalls
    const result = await compactMessages(messages, {
      keepRecentTurns: 2,
      summarizer,
      prefire: cache,
    })
    expect(result).not.toBeNull()
    // Pass-2 should call summarize at least once more
    expect(summarizeCalls).toBeGreaterThan(before)
    const content = typeof result!.summary.content === 'string' ? result!.summary.content : ''
    expect(content.length).toBeGreaterThan(20)
  })
})
