import { describe, it, expect } from 'vitest'
import {
  billableInput,
  cacheHitRate,
  computeCost,
  costRateFromCatalog,
  formatUsd,
  formatUsdMaybeIncomplete,
  resolveCostRateForUsage,
  sumUsagesCost,
  type CostRate,
} from './usageCost'

const rate: CostRate = { input: 0.27, output: 1.1 } // models.dev USD / 1e6 tokens (deepseek-chat-ish)

describe('billableInput', () => {
  it('prefers nonCachedInputTokens when present', () => {
    expect(
      billableInput({
        inputTokens: 1000,
        outputTokens: 0,
        nonCachedInputTokens: 200,
        cacheReadTokens: 700,
        cacheWriteTokens: 100,
      }),
    ).toEqual({ nonCached: 200, cacheRead: 700, cacheWrite: 100 })
  })

  it('falls back to input − cacheRead − cacheWrite without double-counting', () => {
    expect(
      billableInput({
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadTokens: 700,
        cacheWriteTokens: 100,
      }),
    ).toEqual({ nonCached: 200, cacheRead: 700, cacheWrite: 100 })
  })

  it('treats missing cache fields as zero', () => {
    expect(billableInput({ inputTokens: 500, outputTokens: 10 })).toEqual({
      nonCached: 500,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })
})

describe('computeCost', () => {
  it('scales tokens by the models.dev per-million unit (no cache)', () => {
    // 1_000_000 in + 1_000_000 out → exactly input + output dollars
    expect(computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, rate)).toBeCloseTo(1.37, 10)
  })

  it('mixes input and output rates', () => {
    // 500k in × 0.27/1e6 + 250k out × 1.1/1e6 = 0.135 + 0.275 = 0.41
    expect(computeCost({ inputTokens: 500_000, outputTokens: 250_000 }, rate)).toBeCloseTo(0.41, 10)
  })

  it('returns 0 for zero tokens', () => {
    expect(computeCost({ inputTokens: 0, outputTokens: 0 }, rate)).toBe(0)
  })

  it('returns null when no rate is given (token-only)', () => {
    expect(computeCost({ inputTokens: 1000, outputTokens: 1000 }, undefined)).toBeNull()
  })

  it('prices cache with default multipliers when catalog has no cache rates', () => {
    // nonCached 200k * 0.27 + cacheRead 700k * 0.27*0.1 + cacheWrite 100k * 0.27*1.25 + out 0
    // = 0.054 + 0.0189 + 0.03375 = 0.10665
    const cost = computeCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        nonCachedInputTokens: 200_000,
        cacheReadTokens: 700_000,
        cacheWriteTokens: 100_000,
      },
      rate,
    )
    expect(cost).toBeCloseTo(0.10665, 10)
  })

  it('does not charge full input rate on top of cache (avoids double-count)', () => {
    const withCache = computeCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      },
      rate,
    )
    // nonCached=0, cacheRead at 0.1× input rate → 0.027
    expect(withCache).toBeCloseTo(0.027, 10)
    const naive = (1_000_000 * rate.input) / 1e6 // 0.27
    expect(withCache!).toBeLessThan(naive)
  })

  it('uses explicit cache rates from catalog when present', () => {
    const withCache: CostRate = {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    }
    // 100k nonCached * 3 + 800k * 0.3 + 100k * 3.75 + 50k * 15
    // = 0.3 + 0.24 + 0.375 + 0.75 = 1.665
    expect(
      computeCost(
        {
          inputTokens: 1_000_000,
          outputTokens: 50_000,
          nonCachedInputTokens: 100_000,
          cacheReadTokens: 800_000,
          cacheWriteTokens: 100_000,
        },
        withCache,
      ),
    ).toBeCloseTo(1.665, 10)
  })
})

describe('costRateFromCatalog', () => {
  it('maps cache_read / cache_write snake_case from models.dev', () => {
    expect(
      costRateFromCatalog({
        input: 1,
        output: 3.2,
        cache_read: 0.2,
        cache_write: 0,
      }),
    ).toEqual({ input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 })
  })

  it('returns undefined without input/output', () => {
    expect(costRateFromCatalog(undefined)).toBeUndefined()
  })
})

describe('resolveCostRateForUsage / sumUsagesCost (KD-5 / KD-22)', () => {
  const catalog = {
    deepseek: {
      models: {
        'deepseek-chat': { cost: { input: 0.27, output: 1.1 } },
      },
    },
    anthropic: {
      models: {
        'claude-sonnet': {
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        },
      },
    },
  }
  const sessionFallback = costRateFromCatalog(catalog.deepseek.models['deepseek-chat'].cost)

  it('prices by per-usage modelId, not session fallback', () => {
    const { costUsd } = sumUsagesCost(
      [
        {
          inputTokens: 1_000_000,
          outputTokens: 0,
          modelId: 'claude-sonnet',
          providerId: 'anthropic',
        },
      ],
      catalog,
      sessionFallback,
    )
    // 1e6 * 3 / 1e6 = 3 (claude), NOT deepseek 0.27
    expect(costUsd).toBeCloseTo(3, 10)
  })

  it('falls back to session model only when modelId is missing (legacy)', () => {
    const { costUsd } = sumUsagesCost(
      [{ inputTokens: 1_000_000, outputTokens: 0 }],
      catalog,
      sessionFallback,
    )
    expect(costUsd).toBeCloseTo(0.27, 10)
  })

  it('does not reprice modelId rows with the current session model (KD-22)', () => {
    // Two turns on claude, then user switches session to deepseek — costs stay on claude rates.
    const { costUsd } = sumUsagesCost(
      [
        {
          inputTokens: 500_000,
          outputTokens: 0,
          modelId: 'claude-sonnet',
          providerId: 'anthropic',
        },
        {
          inputTokens: 500_000,
          outputTokens: 0,
          modelId: 'claude-sonnet',
          providerId: 'anthropic',
        },
      ],
      catalog,
      sessionFallback, // deepseek — must not apply
    )
    expect(costUsd).toBeCloseTo(3, 10)
  })

  it('skips unknown modelId without falling back (KD-22)', () => {
    expect(
      resolveCostRateForUsage({ modelId: 'ghost-model', providerId: 'x' }, catalog, sessionFallback),
    ).toBeUndefined()
    const { costUsd } = sumUsagesCost(
      [{ inputTokens: 1_000_000, outputTokens: 0, modelId: 'ghost-model' }],
      catalog,
      sessionFallback,
    )
    expect(costUsd).toBeNull()
  })

  it('sums mixed models at their own rates', () => {
    const { costUsd } = sumUsagesCost(
      [
        {
          inputTokens: 1_000_000,
          outputTokens: 0,
          modelId: 'deepseek-chat',
          providerId: 'deepseek',
        },
        {
          inputTokens: 1_000_000,
          outputTokens: 0,
          modelId: 'claude-sonnet',
          providerId: 'anthropic',
        },
      ],
      catalog,
      undefined,
    )
    // 0.27 + 3 = 3.27
    expect(costUsd).toBeCloseTo(3.27, 10)
  })

  it('marks incomplete when any row is incomplete (KD-15 lower-bound)', () => {
    const { costUsd, incomplete } = sumUsagesCost(
      [
        {
          inputTokens: 100_000,
          outputTokens: 0,
          modelId: 'deepseek-chat',
          incomplete: true,
        },
      ],
      catalog,
      sessionFallback,
    )
    expect(incomplete).toBe(true)
    expect(costUsd).toBeCloseTo(0.027, 10) // still lower-bound dollars
  })
})

describe('cacheHitRate', () => {
  it('returns null when cache fields are absent', () => {
    expect(cacheHitRate({ inputTokens: 100, outputTokens: 10 })).toBeNull()
  })

  it('computes cacheRead / billable total', () => {
    expect(
      cacheHitRate({
        inputTokens: 1000,
        outputTokens: 0,
        nonCachedInputTokens: 200,
        cacheReadTokens: 700,
        cacheWriteTokens: 100,
      }),
    ).toBeCloseTo(0.7, 10)
  })
})

describe('formatUsd', () => {
  it('shows sub-cent costs with enough precision', () => {
    expect(formatUsd(0.0012)).toBe('$0.0012')
  })

  it('rounds normal costs to 4 decimals', () => {
    expect(formatUsd(0.41)).toBe('$0.4100')
  })

  it('shows < $0.0001 for tiny non-zero costs', () => {
    expect(formatUsd(0.00001)).toBe('<$0.0001')
  })

  it('shows $0.00 for exactly zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})

describe('formatUsdMaybeIncomplete', () => {
  it('appends * for incomplete lower-bound costs (KD-15)', () => {
    expect(formatUsdMaybeIncomplete(0.41, true)).toBe('$0.4100*')
  })

  it('omits * when complete', () => {
    expect(formatUsdMaybeIncomplete(0.41, false)).toBe('$0.4100')
  })
})
