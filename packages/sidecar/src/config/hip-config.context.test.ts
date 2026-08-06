import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHipConfig } from './hip-config.js'

describe('hip.toml [context] section', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-ctx-cfg-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses camelCase context keys', () => {
    const p = join(dir, 'hip.toml')
    writeFileSync(
      p,
      `
version = 1

[context]
autoCompactPercent = 90
subagentCompactPercent = 65
targetKeepPercent = 45
prefireLeadPercent = 12
twoPass = false
memoryFlushBeforeCompact = false
toolOutputMaxBytes = 20480
outputBufferTokens = 0
gateMode = "percent"
hybridFill = true
costCacheReadMultiplier = 0.1
costCacheWriteMultiplier = 1.25
`,
      'utf8',
    )
    const cfg = readHipConfig(p)
    expect(cfg.context).toEqual({
      autoCompactPercent: 90,
      subagentCompactPercent: 65,
      targetKeepPercent: 45,
      prefireLeadPercent: 12,
      twoPass: false,
      memoryFlushBeforeCompact: false,
      toolOutputMaxBytes: 20480,
      outputBufferTokens: 0,
      gateMode: 'percent',
      hybridFill: true,
      costCacheReadMultiplier: 0.1,
      costCacheWriteMultiplier: 1.25,
    })
  })

  it('parses snake_case context aliases', () => {
    const p = join(dir, 'hip.toml')
    writeFileSync(
      p,
      `
version = 1

[context]
auto_compact_percent = 88
subagent_compact_percent = 72
target_keep_percent = 55
prefire_lead_percent = 8
two_pass = true
memory_flush_before_compact = true
tool_output_max_bytes = 40960
output_buffer_tokens = 20000
gate_mode = "usable"
hybrid_fill = false
cost_cache_read_multiplier = 0.05
cost_cache_write_multiplier = 1.5
prune_protect_tokens = 40000
prune_minimum_tokens = 20000
`,
      'utf8',
    )
    const cfg = readHipConfig(p)
    expect(cfg.context?.autoCompactPercent).toBe(88)
    expect(cfg.context?.subagentCompactPercent).toBe(72)
    expect(cfg.context?.targetKeepPercent).toBe(55)
    expect(cfg.context?.prefireLeadPercent).toBe(8)
    expect(cfg.context?.twoPass).toBe(true)
    expect(cfg.context?.memoryFlushBeforeCompact).toBe(true)
    expect(cfg.context?.toolOutputMaxBytes).toBe(40960)
    expect(cfg.context?.outputBufferTokens).toBe(20_000)
    expect(cfg.context?.gateMode).toBe('usable')
    expect(cfg.context?.hybridFill).toBe(false)
    expect(cfg.context?.costCacheReadMultiplier).toBe(0.05)
    expect(cfg.context?.costCacheWriteMultiplier).toBe(1.5)
    expect(cfg.context?.pruneProtectTokens).toBe(40_000)
    expect(cfg.context?.pruneMinimumTokens).toBe(20_000)
  })

  it('accepts hyphenated gate_mode aliases (parity with env)', () => {
    const p = join(dir, 'hip.toml')
    writeFileSync(
      p,
      `
version = 1

[context]
gate_mode = "percent-minus-buffer"
`,
      'utf8',
    )
    const cfg = readHipConfig(p)
    expect(cfg.context?.gateMode).toBe('percent_minus_buffer')
  })
})
