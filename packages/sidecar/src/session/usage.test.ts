import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  addUsage,
  sumUsage,
  stepContextTokens,
  usageFromModelMetadata,
  serializeTurnUsage,
  parseTurnUsageJson,
  parseTurnUsageObject,
  type LangChainUsageMetadata,
} from './usage.js'
import type { TurnUsage } from '@hip/protocol'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'usage-metadata')

function loadFixture(name: string): LangChainUsageMetadata {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as LangChainUsageMetadata
}

describe('usage helpers', () => {
  it('stepContextTokens prefers contextTokens then input; never billing total', () => {
    expect(stepContextTokens({ inputTokens: 10, outputTokens: 2, totalTokens: 12, contextTokens: 9 })).toBe(9)
    expect(stepContextTokens({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })).toBe(10)
    // MiniMax-style output-only report: total is not context fill
    expect(stepContextTokens({ inputTokens: 0, outputTokens: 2, totalTokens: 12 })).toBe(0)
  })

  it('usageFromModelMetadata uses input as contextTokens', () => {
    expect(usageFromModelMetadata({ input_tokens: 12, output_tokens: 5, total_tokens: 17 })).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      contextTokens: 12,
    })
  })

  it('usageFromModelMetadata falls back to estimate when input is 0 (MiniMax)', () => {
    expect(
      usageFromModelMetadata({ input_tokens: 0, output_tokens: 65, total_tokens: 65 }, 48_000),
    ).toEqual({
      inputTokens: 0,
      outputTokens: 65,
      totalTokens: 65,
      contextTokens: 48_000,
    })
  })

  it('usageFromModelMetadata returns undefined when all zeros and no estimate', () => {
    expect(usageFromModelMetadata({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })).toBeUndefined()
    expect(usageFromModelMetadata(undefined)).toBeUndefined()
  })

  it('usageFromModelMetadata attaches modelId/providerId from meta', () => {
    expect(
      usageFromModelMetadata(
        { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        undefined,
        { modelId: 'claude-sonnet-4', providerId: 'anthropic' },
      ),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      contextTokens: 10,
      modelId: 'claude-sonnet-4',
      providerId: 'anthropic',
    })
  })

  it('fixture anthropic-ish maps cache + reasoning; nonCached = input − cache', () => {
    const u = usageFromModelMetadata(loadFixture('anthropic-ish.json'), undefined, {
      modelId: 'claude-sonnet-4',
      providerId: 'anthropic',
    })
    expect(u).toEqual({
      inputTokens: 12000,
      outputTokens: 400,
      totalTokens: 12400,
      contextTokens: 12000,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1500,
      nonCachedInputTokens: 2500,
      reasoningTokens: 120,
      modelId: 'claude-sonnet-4',
      providerId: 'anthropic',
    })
    expect(u?.incomplete).toBeUndefined()
  })

  it('fixture openai-compat maps prompt_tokens_details.cached_tokens', () => {
    const u = usageFromModelMetadata(loadFixture('openai-compat.json'))
    expect(u).toEqual({
      inputTokens: 5000,
      outputTokens: 200,
      totalTokens: 5200,
      contextTokens: 5000,
      cacheReadTokens: 3000,
      nonCachedInputTokens: 2000,
      reasoningTokens: 50,
    })
    expect(u?.incomplete).toBeUndefined()
  })

  it('fixture minimal omits cache fields and does not set incomplete', () => {
    const u = usageFromModelMetadata(loadFixture('minimal.json'))
    expect(u).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextTokens: 100,
    })
    expect(u).not.toHaveProperty('cacheReadTokens')
    expect(u).not.toHaveProperty('incomplete')
  })

  it('addUsage seeds from undefined accumulator with contextTokens', () => {
    expect(addUsage(undefined, { inputTokens: 3, outputTokens: 2, totalTokens: 5 }))
      .toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5, contextTokens: 3 })
  })

  it('addUsage accumulates billing fields and keeps last step contextTokens', () => {
    const a = addUsage(undefined, { inputTokens: 100_000, outputTokens: 200, totalTokens: 100_200 })
    expect(addUsage(a, { inputTokens: 200_000, outputTokens: 400, totalTokens: 200_400 }))
      .toEqual({
        inputTokens: 300_000,
        outputTokens: 600,
        totalTokens: 300_600,
        contextTokens: 200_000,
      })
  })

  it('addUsage sums cache/reasoning and ORs incomplete; last modelId wins', () => {
    const a = addUsage(undefined, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 40,
      reasoningTokens: 5,
      modelId: 'm1',
      providerId: 'p1',
    })
    const b = addUsage(a, {
      inputTokens: 50,
      outputTokens: 5,
      totalTokens: 55,
      cacheReadTokens: 10,
      cacheWriteTokens: 3,
      incomplete: true,
      modelId: 'm2',
    })
    expect(b).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      totalTokens: 165,
      contextTokens: 50,
      cacheReadTokens: 50,
      cacheWriteTokens: 3,
      nonCachedInputTokens: 97, // recomputed: 150 − 50 − 3
      reasoningTokens: 5,
      incomplete: true,
      modelId: 'm2',
      providerId: 'p1',
    })
  })

  it('addUsage does not mutate the previous accumulator', () => {
    const a: TurnUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2, contextTokens: 1 }
    addUsage(a, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })
    expect(a).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2, contextTokens: 1 })
  })

  it('sumUsage returns undefined for an empty list (no usage reported)', () => {
    expect(sumUsage([])).toBeUndefined()
    expect(sumUsage([undefined, undefined])).toBeUndefined()
  })

  it('sumUsage adds billing fields and takes max contextTokens across agents', () => {
    expect(sumUsage([
      { inputTokens: 300_000, outputTokens: 20, totalTokens: 300_020, contextTokens: 200_000 },
      undefined,
      { inputTokens: 50_000, outputTokens: 5, totalTokens: 50_005, contextTokens: 40_000 },
    ])).toEqual({
      inputTokens: 350_000,
      outputTokens: 25,
      totalTokens: 350_025,
      contextTokens: 200_000,
    })
  })

  it('sumUsage folds cache fields and ORs incomplete', () => {
    expect(sumUsage([
      { inputTokens: 10, outputTokens: 1, totalTokens: 11, cacheReadTokens: 4, incomplete: true },
      { inputTokens: 20, outputTokens: 2, totalTokens: 22, cacheWriteTokens: 1, modelId: 'x' },
    ])).toEqual({
      inputTokens: 30,
      outputTokens: 3,
      totalTokens: 33,
      contextTokens: 20,
      cacheReadTokens: 4,
      cacheWriteTokens: 1,
      nonCachedInputTokens: 25, // recomputed: 30 − 4 − 1
      incomplete: true,
      modelId: 'x',
    })
  })

  it('addUsage recomputes nonCached when folding cache-aware with cache-unaware step', () => {
    const a = addUsage(undefined, {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      nonCachedInputTokens: 50,
    })
    // Second step has no cache metadata (omit ≠ incomplete)
    const b = addUsage(a, { inputTokens: 50, outputTokens: 5, totalTokens: 55 })
    expect(b).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      totalTokens: 165,
      contextTokens: 50,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      // Recomputed from folded totals: 150 − 40 − 10 (not partial nonCached sum 50)
      nonCachedInputTokens: 100,
    })
    expect(b.incomplete).toBeUndefined()
  })

  it('serializeTurnUsage / parseTurnUsageJson round-trip extended fields', () => {
    const u: TurnUsage = {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      contextTokens: 100,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      nonCachedInputTokens: 55,
      reasoningTokens: 8,
      modelId: 'gpt-4o',
      providerId: 'openai',
      incomplete: true,
    }
    const raw = serializeTurnUsage(u)
    expect(parseTurnUsageJson(raw)).toEqual(u)
    expect(parseTurnUsageObject(JSON.parse(raw))).toEqual(u)
  })

  it('parseTurnUsageJson returns undefined for invalid JSON or missing core fields', () => {
    expect(parseTurnUsageJson(null)).toBeUndefined()
    expect(parseTurnUsageJson('')).toBeUndefined()
    expect(parseTurnUsageJson('not-json')).toBeUndefined()
    expect(parseTurnUsageJson(JSON.stringify({ inputTokens: 1 }))).toBeUndefined()
  })

  it('parseTurnUsageObject rejects negative optional token fields', () => {
    expect(parseTurnUsageObject({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cacheReadTokens: -1,
      contextTokens: 0,
      reasoningTokens: -5,
    })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
    })
  })
})
