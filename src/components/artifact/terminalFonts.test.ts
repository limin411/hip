// @vitest-environment happy-dom
/**
 * 内置 Nerd Font 回归守卫（SPEC §9.1）：
 * 1. xterm 字体栈首项必须是内置 Nerd Font 族（防回退成系统字体栈）
 * 2. woff2 产物与 manifest 完整性（防误删 / 空文件 / 坏文件）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { TERMINAL_FONT_STACK } from './XtermSurface'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const EXPECTED_WOFF2 = [
  'public/fonts/nerd/JetBrainsMonoNerdFontMono-Regular.woff2',
  'public/fonts/nerd/JetBrainsMonoNerdFontMono-Bold.woff2',
]

describe('terminal bundled Nerd Font (SPEC doc-terminal-nerd-fonts §9.1)', () => {
  it('xterm 字体栈以内置 Nerd Font 族开头', () => {
    expect(TERMINAL_FONT_STACK).toMatch(/^"JetBrainsMono Nerd Font Mono", /)
  })

  it('双字重 woff2 产物存在且非空（>100KB），魔数 wOF2', () => {
    for (const rel of EXPECTED_WOFF2) {
      const p = resolve(ROOT, rel)
      expect(statSync(p).size, rel).toBeGreaterThan(100 * 1024)
      const magic = readFileSync(p).subarray(0, 4).toString('ascii')
      expect(magic, rel).toBe('wOF2')
    }
  })

  it('manifest 与产物一致，预算参数合理', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, 'scripts/font-manifest.json'), 'utf8'),
    ) as {
      family: string
      upstream: { tag: string; zipSha256: string }
      fonts: { weight: number; output: string; sha256: string }[]
      budget: { targetBytes: number; hardLimitBytes: number }
    }
    expect(manifest.family).toBe('JetBrainsMono Nerd Font Mono')
    expect(manifest.upstream.tag).toMatch(/^v\d+\.\d+\.\d+$/)
    expect(manifest.upstream.zipSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.fonts).toHaveLength(2)
    expect(manifest.fonts.map((f) => f.weight).sort()).toEqual([400, 700])
    for (const f of manifest.fonts) {
      expect(f.sha256, f.output).toMatch(/^[0-9a-f]{64}$/)
      expect(statSync(resolve(ROOT, f.output)).size, f.output).toBeGreaterThan(100 * 1024)
    }
    expect(manifest.budget.targetBytes).toBeLessThan(manifest.budget.hardLimitBytes)
  })
})
