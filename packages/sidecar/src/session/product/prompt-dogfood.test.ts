import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../../../../../')
const dogfood = join(root, 'scripts/product-prompt-dogfood.mjs')

describe('product-prompt dogfood harness', () => {
  it('static policy matrix passes (offline, no paid LLM)', () => {
    const out = execFileSync(process.execPath, ['--import', 'tsx', dogfood, '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    // last non-empty line is JSON summary
    const lines = out.trim().split('\n').filter(Boolean)
    const summary = JSON.parse(lines[lines.length - 1]!) as {
      ok: boolean
      hitRate: number
      codeBareChars: number
    }
    expect(summary.ok).toBe(true)
    expect(summary.hitRate).toBe(1)
    expect(summary.codeBareChars).toBeLessThanOrEqual(4200)
  }, 30_000)
})
