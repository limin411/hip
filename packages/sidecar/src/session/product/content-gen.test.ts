import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HIP_PRODUCT_VERSION, PRODUCT_CAPABILITY_MAP, PRODUCT_SKILL_VERSION } from './content.js'

const root = join(import.meta.dirname, '../../../../../')
const script = join(root, 'scripts/generate-product-content.mjs')

describe('product content SoT generator', () => {
  it('yarn product:content:check — content.ts matches docs/product/', () => {
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).not.toThrow()
  })

  it('ops content.ts matches docs/ops/', () => {
    const opsScript = join(root, 'scripts/generate-ops-content.mjs')
    expect(() =>
      execFileSync(process.execPath, [opsScript, '--check'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).not.toThrow()
  })

  it('embeds package version and L0 capability map from SoT', () => {
    expect(HIP_PRODUCT_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(PRODUCT_SKILL_VERSION).toBeTruthy()
    expect(PRODUCT_CAPABILITY_MAP).toContain(HIP_PRODUCT_VERSION)
    expect(PRODUCT_CAPABILITY_MAP).toMatch(/auth\.json/)
    expect(PRODUCT_CAPABILITY_MAP).toMatch(/off by default/)
  })
})
