import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_CONTEXT_POLICY,
  resolveContextPolicy,
} from './context-policy.js'

const ENV_KEYS = [
  'HIP_TWO_PASS_COMPACT',
  'HIP_CONTEXT_AUTO_COMPACT_PERCENT',
  'HIP_CONTEXT_SUBAGENT_COMPACT_PERCENT',
  'HIP_CONTEXT_TARGET_KEEP_PERCENT',
  'HIP_CONTEXT_PREFIRE_LEAD_PERCENT',
  'HIP_CONTEXT_MEMORY_FLUSH',
  'HIP_TOOL_OUTPUT_MAX_BYTES',
  'HIP_CONTEXT_OUTPUT_BUFFER_TOKENS',
  'HIP_CONTEXT_GATE_MODE',
  'HIP_CONTEXT_HYBRID_FILL',
  'HIP_CONTEXT_COST_CACHE_READ_MULT',
  'HIP_CONTEXT_COST_CACHE_WRITE_MULT',
  'HIP_CONTEXT_PRUNE_PROTECT_TOKENS',
  'HIP_CONTEXT_PRUNE_MINIMUM_TOKENS',
] as const

describe('resolveContextPolicy', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns defaults when no partial and no env', () => {
    expect(resolveContextPolicy()).toEqual(DEFAULT_CONTEXT_POLICY)
    expect(DEFAULT_CONTEXT_POLICY.autoCompactPercent).toBe(85)
    expect(DEFAULT_CONTEXT_POLICY.subagentCompactPercent).toBe(70)
    expect(DEFAULT_CONTEXT_POLICY.targetKeepPercent).toBe(50)
    expect(DEFAULT_CONTEXT_POLICY.prefireLeadPercent).toBe(10)
    expect(DEFAULT_CONTEXT_POLICY.twoPass).toBe(true)
    expect(DEFAULT_CONTEXT_POLICY.memoryFlushBeforeCompact).toBe(true)
    expect(DEFAULT_CONTEXT_POLICY.toolOutputMaxBytes).toBe(40 * 1024)
    // KD-3 / KD-19 defaults
    expect(DEFAULT_CONTEXT_POLICY.outputBufferTokens).toBe(0)
    expect(DEFAULT_CONTEXT_POLICY.gateMode).toBe('percent')
    expect(DEFAULT_CONTEXT_POLICY.hybridFill).toBe(true)
    expect(DEFAULT_CONTEXT_POLICY.costCacheReadMultiplier).toBe(0.1)
    expect(DEFAULT_CONTEXT_POLICY.costCacheWriteMultiplier).toBe(1.25)
  })

  it('applies hip.toml-style partial', () => {
    const p = resolveContextPolicy({
      autoCompactPercent: 90,
      subagentCompactPercent: 60,
      targetKeepPercent: 40,
      prefireLeadPercent: 15,
      twoPass: false,
      memoryFlushBeforeCompact: false,
      toolOutputMaxBytes: 20_000,
      outputBufferTokens: 20_000,
      gateMode: 'usable',
      hybridFill: false,
      costCacheReadMultiplier: 0.05,
      costCacheWriteMultiplier: 1.5,
      pruneProtectTokens: 40_000,
      pruneMinimumTokens: 20_000,
    })
    expect(p.autoCompactPercent).toBe(90)
    expect(p.subagentCompactPercent).toBe(60)
    expect(p.targetKeepPercent).toBe(40)
    expect(p.prefireLeadPercent).toBe(15)
    expect(p.twoPass).toBe(false)
    expect(p.memoryFlushBeforeCompact).toBe(false)
    expect(p.toolOutputMaxBytes).toBe(20_000)
    expect(p.outputBufferTokens).toBe(20_000)
    expect(p.gateMode).toBe('usable')
    expect(p.hybridFill).toBe(false)
    expect(p.costCacheReadMultiplier).toBe(0.05)
    expect(p.costCacheWriteMultiplier).toBe(1.5)
    expect(p.pruneProtectTokens).toBe(40_000)
    expect(p.pruneMinimumTokens).toBe(20_000)
  })

  it('clamps percent fields to 1..100', () => {
    const p = resolveContextPolicy({
      autoCompactPercent: 150,
      targetKeepPercent: 0,
    })
    expect(p.autoCompactPercent).toBe(100)
    expect(p.targetKeepPercent).toBe(1)
  })

  it('env overrides config', () => {
    process.env.HIP_TWO_PASS_COMPACT = '0'
    process.env.HIP_CONTEXT_AUTO_COMPACT_PERCENT = '80'
    process.env.HIP_CONTEXT_MEMORY_FLUSH = 'false'
    process.env.HIP_TOOL_OUTPUT_MAX_BYTES = '8192'
    process.env.HIP_CONTEXT_OUTPUT_BUFFER_TOKENS = '16000'
    process.env.HIP_CONTEXT_GATE_MODE = 'percent_minus_buffer'
    process.env.HIP_CONTEXT_HYBRID_FILL = '0'
    process.env.HIP_CONTEXT_COST_CACHE_READ_MULT = '0.2'
    process.env.HIP_CONTEXT_COST_CACHE_WRITE_MULT = '1.1'
    const p = resolveContextPolicy({
      autoCompactPercent: 90,
      twoPass: true,
      memoryFlushBeforeCompact: true,
      toolOutputMaxBytes: 40_000,
      outputBufferTokens: 0,
      gateMode: 'percent',
      hybridFill: true,
    })
    expect(p.twoPass).toBe(false)
    expect(p.autoCompactPercent).toBe(80)
    expect(p.memoryFlushBeforeCompact).toBe(false)
    expect(p.toolOutputMaxBytes).toBe(8192)
    expect(p.outputBufferTokens).toBe(16_000)
    expect(p.gateMode).toBe('percent_minus_buffer')
    expect(p.hybridFill).toBe(false)
    expect(p.costCacheReadMultiplier).toBe(0.2)
    expect(p.costCacheWriteMultiplier).toBe(1.1)
  })
})
