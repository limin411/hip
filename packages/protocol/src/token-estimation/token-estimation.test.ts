import { describe, it, expect } from 'vitest'
import {
  CHARS_PER_TOKEN,
  IMAGE_TOKEN_ESTIMATE,
  TOOL_SCHEMA_OVERHEAD_CHARS,
  DEFAULT_OUTPUT_BUFFER_CAP,
  estimateTextTokens,
  estimateImageTokens,
  estimateToolSchemaTokens,
  estimateToolsTokens,
  exceedsThreshold,
  exceedsThresholdWithBuffer,
  usableContextTokens,
  usableContextTokensFromBuffer,
  exceedsGate,
  freeTokens,
  usagePercentage,
} from './index.js'

describe('constants', () => {
  it('matches design / KD values', () => {
    expect(CHARS_PER_TOKEN).toBe(4)
    expect(IMAGE_TOKEN_ESTIMATE).toBe(765)
    expect(TOOL_SCHEMA_OVERHEAD_CHARS).toBe(400)
    expect(DEFAULT_OUTPUT_BUFFER_CAP).toBe(20_000)
  })
})

describe('estimateTextTokens', () => {
  it('uses ceil(len/4) — KD-10', () => {
    expect(estimateTextTokens('')).toBe(0)
    expect(estimateTextTokens('abc')).toBe(1)
    expect(estimateTextTokens('abcd')).toBe(1)
    expect(estimateTextTokens('abcde')).toBe(2)
    expect(estimateTextTokens('x'.repeat(4000))).toBe(1000)
  })
})

describe('estimateImageTokens', () => {
  it('multiplies IMAGE_TOKEN_ESTIMATE', () => {
    expect(estimateImageTokens(0)).toBe(0)
    expect(estimateImageTokens(-1)).toBe(0)
    expect(estimateImageTokens(1)).toBe(IMAGE_TOKEN_ESTIMATE)
    expect(estimateImageTokens(3)).toBe(3 * IMAGE_TOKEN_ESTIMATE)
  })
})

describe('estimateToolSchemaTokens', () => {
  it('defaults to fixed overhead when omitted', () => {
    expect(estimateToolSchemaTokens()).toBe(Math.ceil(TOOL_SCHEMA_OVERHEAD_CHARS / 4))
    expect(estimateToolSchemaTokens()).toBe(100)
  })

  it('estimates from schema JSON string', () => {
    expect(estimateToolSchemaTokens('abcd')).toBe(1)
    expect(estimateToolSchemaTokens('x'.repeat(400))).toBe(100)
  })

  it('treats number as character overhead', () => {
    expect(estimateToolSchemaTokens(400)).toBe(100)
    expect(estimateToolSchemaTokens(0)).toBe(0)
  })
})

describe('estimateToolsTokens', () => {
  it('fixed-overhead path uses single aggregate ceil (zero delta vs pre-PR)', () => {
    expect(estimateToolsTokens([])).toBe(0)
    expect(estimateToolsTokens(undefined)).toBe(0)

    // name 'a' + desc 'b' + 400 = 402 → ceil(402/4) = 101 (not per-field 102)
    expect(estimateToolsTokens([{ name: 'a', description: 'b' }])).toBe(101)
    // name "read"(4) + desc "file"(4) + 400 = 408 → ceil = 102
    expect(estimateToolsTokens([{ name: 'read', description: 'file' }])).toBe(102)
  })

  it('schemaJson path estimates name/desc/schema as text', () => {
    const withSchema = estimateToolsTokens([
      { name: 'a', description: '', schemaJson: 'xxxx' }, // schema 1 token
    ])
    expect(withSchema).toBe(1 + 0 + 1)
  })
})

describe('exceedsThreshold', () => {
  it('fires on strict 85% boundary (integer arithmetic)', () => {
    expect(exceedsThreshold(849, 1000, 85)).toBe(false)
    expect(exceedsThreshold(850, 1000, 85)).toBe(true)
    expect(exceedsThreshold(0, 0, 85)).toBe(false)
  })

  it('matches worked example: 128k @ 85% → 108_800', () => {
    expect(exceedsThreshold(108_799, 128_000, 85)).toBe(false)
    expect(exceedsThreshold(108_800, 128_000, 85)).toBe(true)
  })
})

describe('exceedsThresholdWithBuffer (percent_minus_buffer)', () => {
  it('with buffer 0 matches exceedsThreshold', () => {
    for (const used of [0, 849, 850, 1000]) {
      expect(exceedsThresholdWithBuffer(used, 1000, 85, 0)).toBe(
        exceedsThreshold(used, 1000, 85),
      )
    }
  })

  it('subtracts headroom — 100k @ 85% buf 4k fires at 81k', () => {
    expect(exceedsThresholdWithBuffer(80_999, 100_000, 85, 4_000)).toBe(false)
    expect(exceedsThresholdWithBuffer(81_000, 100_000, 85, 4_000)).toBe(true)
  })

  it('worked example: 128k 85% buf 20k → 88_800 (~69%)', () => {
    // 128000*85 - 20000*100 = 10_880_000 - 2_000_000 = 8_880_000 → used*100 >= that → used >= 88800
    expect(exceedsThresholdWithBuffer(88_799, 128_000, 85, 20_000)).toBe(false)
    expect(exceedsThresholdWithBuffer(88_800, 128_000, 85, 20_000)).toBe(true)
  })

  it('false for zero window', () => {
    expect(exceedsThresholdWithBuffer(100, 0, 85, 4_000)).toBe(false)
  })

  it('buffer dominating threshold clamps boundary → always over budget', () => {
    // 1000*85 - 1_000_000*100 is negative → clamped to 0 → used*100 >= 0
    expect(exceedsThresholdWithBuffer(0, 1000, 85, 1_000_000)).toBe(true)
    expect(exceedsThresholdWithBuffer(1, 1000, 85, 1_000_000)).toBe(true)
  })
})

describe('usableContextTokens', () => {
  it('reserves min(bufferCap, maxOutput)', () => {
    expect(usableContextTokens(128_000, 8_000, 20_000)).toBe(120_000)
    expect(usableContextTokens(128_000, 40_000, 20_000)).toBe(108_000)
    expect(usableContextTokens(128_000, null, 20_000)).toBe(108_000)
    expect(usableContextTokens(128_000)).toBe(128_000 - DEFAULT_OUTPUT_BUFFER_CAP)
  })

  it('clamps reserved to window', () => {
    expect(usableContextTokens(10_000, 50_000, 20_000)).toBe(0)
  })

  it('usableContextTokensFromBuffer uses configured buffer', () => {
    expect(usableContextTokensFromBuffer(128_000, 20_000)).toBe(108_000)
    expect(usableContextTokensFromBuffer(128_000, 20_000, 8_000)).toBe(120_000)
    expect(usableContextTokensFromBuffer(128_000, 0)).toBe(128_000)
  })
})

describe('exceedsGate modes', () => {
  it('percent ignores buffer', () => {
    expect(exceedsGate(850, 1000, 85, { gateMode: 'percent', bufferTokens: 200 })).toBe(true)
    expect(exceedsGate(849, 1000, 85, { gateMode: 'percent', bufferTokens: 200 })).toBe(false)
  })

  it('percent_minus_buffer uses headroom formula', () => {
    expect(
      exceedsGate(81_000, 100_000, 85, {
        gateMode: 'percent_minus_buffer',
        bufferTokens: 4_000,
      }),
    ).toBe(true)
    expect(
      exceedsGate(80_999, 100_000, 85, {
        gateMode: 'percent_minus_buffer',
        bufferTokens: 4_000,
      }),
    ).toBe(false)
  })

  it('usable: fire at 100% of usable width', () => {
    // window 128k, buffer 20k → usable 108k; pct 100 → fire at 108k
    expect(
      exceedsGate(107_999, 128_000, 100, { gateMode: 'usable', bufferTokens: 20_000 }),
    ).toBe(false)
    expect(
      exceedsGate(108_000, 128_000, 100, { gateMode: 'usable', bufferTokens: 20_000 }),
    ).toBe(true)
  })

  it('usable: fire at 85% of usable width', () => {
    // usable 108k * 85% = 91800
    expect(
      exceedsGate(91_799, 128_000, 85, { gateMode: 'usable', bufferTokens: 20_000 }),
    ).toBe(false)
    expect(
      exceedsGate(91_800, 128_000, 85, { gateMode: 'usable', bufferTokens: 20_000 }),
    ).toBe(true)
  })

  it('default mode is percent', () => {
    expect(exceedsGate(850, 1000, 85)).toBe(true)
    expect(exceedsGate(849, 1000, 85)).toBe(false)
  })

  it('usable with buffer >= window is always over budget', () => {
    expect(exceedsGate(0, 10_000, 85, { gateMode: 'usable', bufferTokens: 50_000 })).toBe(true)
    expect(exceedsGate(1, 10_000, 100, { gateMode: 'usable', bufferTokens: 10_000 })).toBe(true)
  })
})

describe('freeTokens / usagePercentage', () => {
  it('freeTokens saturates at 0', () => {
    expect(freeTokens(100, 30)).toBe(70)
    expect(freeTokens(100, 100)).toBe(0)
    expect(freeTokens(100, 200)).toBe(0)
    expect(freeTokens(0, 10)).toBe(0)
  })

  it('usagePercentage clamps and handles zero total', () => {
    expect(usagePercentage(0, 0)).toBe(0)
    expect(usagePercentage(50, 100)).toBe(50)
    expect(usagePercentage(150, 100)).toBe(100)
    expect(usagePercentage(100, 0)).toBe(0)
  })
})
