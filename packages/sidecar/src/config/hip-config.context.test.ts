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
  })
})
