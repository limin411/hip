import { describe, it, expect } from 'vitest'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import {
  AUTO_COMPACT_THRESHOLD_PERCENT,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_COMPACT_TRIGGER_TOKENS,
  DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS,
  MIN_SUMMARY_SEED_CHARS,
  MIN_TARGET_KEEP_TOKENS,
  SUBAGENT_COMPACT_THRESHOLD_PERCENT,
  TARGET_THRESHOLD_PERCENT,
  compactTriggerTokens,
  effectiveUsedTokens,
  estimateMessagesTokens,
  estimatePromptTokens,
  estimateTextTokens,
  estimateToolsTokens,
  exceedsThreshold,
  extractiveSummaryFallback,
  isDegenerateSummary,
  messageKeepTokenBudget,
  remainingBudgetPercent,
  selectKeepUnitsByTokenBudget,
  targetKeepTokens,
  usageFillPercent,
  createContextPressureState,
  resetPressureOnUsage,
  addPressureDelta,
  reducePressureDelta,
  hybridUsedTokens,
} from './context-budget.js'

describe('estimateTextTokens / estimateMessagesTokens', () => {
  it('uses chars/4 (ceil)', () => {
    expect(estimateTextTokens('abcd')).toBe(1)
    expect(estimateTextTokens('abcde')).toBe(2)
    expect(estimateMessagesTokens([new HumanMessage('12345678')])).toBe(2)
  })
})

describe('estimatePromptTokens', () => {
  it('includes system + tools overhead', () => {
    const messages = [new HumanMessage('abcd')] // 1 token
    const systemOnly = estimatePromptTokens({ messages, systemPrompt: 'xxxx' }) // +1
    expect(systemOnly).toBeGreaterThan(estimateMessagesTokens(messages))

    const withTools = estimatePromptTokens({
      messages,
      systemPrompt: '',
      tools: [{ name: 'read_file', description: 'read a file' }],
    })
    expect(withTools).toBeGreaterThan(estimateMessagesTokens(messages))
    expect(estimateToolsTokens([{ name: 'a', description: 'b' }])).toBeGreaterThan(0)
  })

  it('fixed-overhead tools use aggregate ceil (pre-PR zero delta)', () => {
    // name 'a' + desc 'b' + 400 = 402 → ceil(402/4) = 101
    expect(estimateToolsTokens([{ name: 'a', description: 'b' }])).toBe(101)
  })
})

describe('compactTriggerTokens clamp aligns with exceedsThreshold', () => {
  it('rounds fractional percent the same way as the gate', () => {
    // 85.4 → rounds to 85; both helpers must agree
    const cw = 1000
    const trigger = compactTriggerTokens(cw, 85.4)
    expect(trigger).toBe(850)
    expect(exceedsThreshold(trigger, cw, 85.4)).toBe(true)
    expect(exceedsThreshold(trigger - 1, cw, 85.4)).toBe(false)
  })
})

describe('exceedsThreshold', () => {
  it('fires on strict 85% boundary (integer arithmetic)', () => {
    // 1000 * 85 / 100 = 850
    expect(exceedsThreshold(849, 1000, 85)).toBe(false)
    expect(exceedsThreshold(850, 1000, 85)).toBe(true)
    expect(exceedsThreshold(0, 0, 85)).toBe(false)
  })

  it('default threshold is AUTO_COMPACT_THRESHOLD_PERCENT', () => {
    expect(AUTO_COMPACT_THRESHOLD_PERCENT).toBe(85)
    const cw = 100_000
    const trigger = compactTriggerTokens(cw)
    expect(trigger).toBe(85_000)
    expect(exceedsThreshold(trigger, cw)).toBe(true)
    expect(exceedsThreshold(trigger - 1, cw)).toBe(false)
  })
})

describe('compactTriggerTokens defaults', () => {
  it('derives supervisor and subagent defaults from DEFAULT_CONTEXT_WINDOW', () => {
    expect(DEFAULT_COMPACT_TRIGGER_TOKENS).toBe(
      compactTriggerTokens(DEFAULT_CONTEXT_WINDOW, AUTO_COMPACT_THRESHOLD_PERCENT),
    )
    expect(DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS).toBe(
      compactTriggerTokens(DEFAULT_CONTEXT_WINDOW, SUBAGENT_COMPACT_THRESHOLD_PERCENT),
    )
    expect(DEFAULT_SUBAGENT_COMPACT_TRIGGER_TOKENS).toBeLessThan(DEFAULT_COMPACT_TRIGGER_TOKENS)
  })
})

describe('remainingBudgetPercent / usageFillPercent', () => {
  it('remaining is inverse of fill', () => {
    expect(usageFillPercent(25_000, 100_000)).toBe(25)
    expect(remainingBudgetPercent(25_000, 100_000)).toBe(75)
    expect(remainingBudgetPercent(0, 0)).toBe(100)
    expect(usageFillPercent(200, 100)).toBe(100)
  })
})

describe('effectiveUsedTokens', () => {
  it('takes max of estimate and last real prompt tokens', () => {
    expect(effectiveUsedTokens(100, 50)).toBe(100)
    expect(effectiveUsedTokens(100, 200)).toBe(200)
    expect(effectiveUsedTokens(100, null)).toBe(100)
    expect(effectiveUsedTokens(100, 0)).toBe(100)
  })
})

describe('hybridUsedTokens / ContextPressureState (PR-3)', () => {
  it('after tools add N tokens with lastProvider=P, used >= P+N even if full re-estimate is low', () => {
    const P = 90_000
    const N = 5_000
    const pressure = createContextPressureState({ lastProviderContextTokens: P })
    addPressureDelta(pressure, N)
    // Full re-estimate systematically underestimates (biased low).
    const lowEstimate = 10_000
    const used = hybridUsedTokens(lowEstimate, pressure, true)
    expect(used).toBeGreaterThanOrEqual(P + N)
    expect(used).toBe(P + N)
  })

  it('never double-counts fullEstimate + delta', () => {
    const pressure = createContextPressureState({
      lastProviderContextTokens: 50_000,
      estimatedTokensSinceModel: 2_000,
    })
    // fullEstimate already includes tool bodies; hybrid takes max, not sum.
    expect(hybridUsedTokens(51_000, pressure, true)).toBe(52_000)
    expect(hybridUsedTokens(60_000, pressure, true)).toBe(60_000)
  })

  it('hybrid off falls back to effectiveUsedTokens(estimate, lastPrompt)', () => {
    const pressure = createContextPressureState({
      lastProviderContextTokens: 90_000,
      estimatedTokensSinceModel: 5_000,
    })
    expect(hybridUsedTokens(10_000, pressure, false, 80_000)).toBe(80_000)
    expect(hybridUsedTokens(10_000, pressure, false, null)).toBe(90_000)
  })

  it('resetPressureOnUsage clears delta and sets watermark', () => {
    const pressure = createContextPressureState({
      lastProviderContextTokens: 10,
      estimatedTokensSinceModel: 999,
      lastModelMessageCount: 1,
    })
    resetPressureOnUsage(pressure, 42_000, 7)
    expect(pressure.lastProviderContextTokens).toBe(42_000)
    expect(pressure.estimatedTokensSinceModel).toBe(0)
    expect(pressure.lastModelMessageCount).toBe(7)
  })

  it('reducePressureDelta clamps at 0', () => {
    const pressure = createContextPressureState({ estimatedTokensSinceModel: 100 })
    reducePressureDelta(pressure, 40)
    expect(pressure.estimatedTokensSinceModel).toBe(60)
    reducePressureDelta(pressure, 1000)
    expect(pressure.estimatedTokensSinceModel).toBe(0)
  })
})

describe('isDegenerateSummary / extractiveSummaryFallback', () => {
  it('flags empty and short summaries', () => {
    expect(isDegenerateSummary('')).toBe(true)
    expect(isDegenerateSummary('short')).toBe(true)
    expect(isDegenerateSummary('x'.repeat(MIN_SUMMARY_SEED_CHARS))).toBe(false)
  })

  it('builds extractive fallback from messages', () => {
    const text = extractiveSummaryFallback([
      new SystemMessage('sys'),
      new HumanMessage('please fix the bug in auth.ts'),
    ])
    expect(text).toContain('[extractive]')
    expect(text).toContain('auth.ts')
  })
})

describe('targetKeepTokens / selectKeepUnitsByTokenBudget', () => {
  it('defaults to 50% of the context window (floored at MIN_TARGET_KEEP_TOKENS)', () => {
    expect(TARGET_THRESHOLD_PERCENT).toBe(50)
    expect(targetKeepTokens(100_000)).toBe(50_000)
    expect(targetKeepTokens(1_000)).toBe(MIN_TARGET_KEEP_TOKENS)
  })

  it('subtracts fixed overhead for message keep budget', () => {
    expect(messageKeepTokenBudget(100_000, 10_000)).toBe(40_000)
    expect(messageKeepTokenBudget(100_000, 60_000)).toBe(MIN_TARGET_KEEP_TOKENS)
  })

  it('keeps newest units within the token budget and leaves a middle', () => {
    // unit tokens oldest→newest: 100, 100, 100, 100
    const keep = selectKeepUnitsByTokenBudget([100, 100, 100, 100], 250, {
      minKeep: 1,
      maxKeep: 3,
    })
    // 100+100=200 ≤ 250; +100 would be 300 > 250 → keep 2
    expect(keep).toBe(2)
  })

  it('honors minKeep even when over budget', () => {
    expect(selectKeepUnitsByTokenBudget([500, 500], 10, { minKeep: 1, maxKeep: 1 })).toBe(1)
  })

  it('returns 0 for empty input', () => {
    expect(selectKeepUnitsByTokenBudget([], 1000)).toBe(0)
  })
})
