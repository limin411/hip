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
  'HIP_CONTEXT_CACHE_POLICY',
  'HIP_CONTEXT_PROMPT_CACHE_KEY',
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
    expect(DEFAULT_CONTEXT_POLICY.cachePolicy).toBe('auto')
    expect(DEFAULT_CONTEXT_POLICY.promptCacheKey).toBe('session')
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
      cachePolicy: 'none',
      promptCacheKey: 'none',
    })
    expect(p.autoCompactPercent).toBe(90)
    expect(p.subagentCompactPercent).toBe(60)
    expect(p.targetKeepPercent).toBe(40)
    expect(p.prefireLeadPercent).toBe(15)
    expect(p.twoPass).toBe(false)
    expect(p.memoryFlushBeforeCompact).toBe(false)
    expect(p.toolOutputMaxBytes).toBe(20_000)
    expect(p.cachePolicy).toBe('none')
    expect(p.promptCacheKey).toBe('none')
  })

  it('maps cachePolicy off → none', () => {
    expect(resolveContextPolicy({ cachePolicy: 'off' }).cachePolicy).toBe('none')
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
    process.env.HIP_CONTEXT_CACHE_POLICY = 'off'
    process.env.HIP_CONTEXT_PROMPT_CACHE_KEY = 'none'
    const p = resolveContextPolicy({
      autoCompactPercent: 90,
      twoPass: true,
      memoryFlushBeforeCompact: true,
      toolOutputMaxBytes: 40_000,
      cachePolicy: 'auto',
      promptCacheKey: 'session',
    })
    expect(p.twoPass).toBe(false)
    expect(p.autoCompactPercent).toBe(80)
    expect(p.memoryFlushBeforeCompact).toBe(false)
    expect(p.toolOutputMaxBytes).toBe(8192)
    expect(p.cachePolicy).toBe('none')
    expect(p.promptCacheKey).toBe('none')
  })
})
