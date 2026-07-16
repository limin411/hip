/**
 * Keep permission mode chip labels short enough for composer chrome.
 * Full explanations stay in permission.desc.*
 */
import { describe, expect, it } from 'vitest'
import { zhCN } from '@/i18n/zh-CN'
import { en } from '@/i18n/en'

describe('permission mode chip labels', () => {
  it('zh-CN mode labels stay short (chip max ~140px)', () => {
    const modes = zhCN.translation.chat.permission.modes
    for (const key of ['chat', 'edit', 'full'] as const) {
      // Avoid multi-clause descriptions as chip text (desc.* holds detail)
      expect(modes[key].length).toBeLessThanOrEqual(6)
      expect(modes[key]).not.toMatch(/目录|目录内|任意目录/)
    }
  })

  it('en mode labels stay short', () => {
    const modes = en.translation.chat.permission.modes
    for (const key of ['chat', 'edit', 'full'] as const) {
      expect(modes[key].length).toBeLessThanOrEqual(14)
    }
  })

  it('desc strings remain longer than mode labels (detail lives in menu)', () => {
    const m = zhCN.translation.chat.permission.modes
    const d = zhCN.translation.chat.permission.desc
    expect(d.edit.length).toBeGreaterThan(m.edit.length)
    expect(d.full.length).toBeGreaterThan(m.full.length)
  })
})
