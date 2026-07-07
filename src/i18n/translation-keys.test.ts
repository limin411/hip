// src/i18n/translation-keys.test.ts
import { describe, it, expect } from 'vitest'
import { en } from './en'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'

/**
 * Recursively extract all dot-separated key paths from a nested object.
 * Example: { chat: { title: 'Hi' } } → ['chat.title']
 */
function deepKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...deepKeys(v as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

function diffSets(a: Set<string>, b: Set<string>, labelA: string, labelB: string): string[] {
  const issues: string[] = []
  for (const key of a) {
    if (!b.has(key)) issues.push(`Key "${key}" exists in ${labelA} but not in ${labelB}`)
  }
  return issues
}

describe('Translation key consistency', () => {
  const locales = [
    { name: 'en', obj: en.translation },
    { name: 'zh-CN', obj: zhCN.translation },
    { name: 'zh-TW', obj: zhTW.translation },
  ]

  const keySets = locales.map((l) => ({
    name: l.name,
    keys: new Set(deepKeys(l.obj as Record<string, unknown>)),
  }))

  it('en, zh-CN, and zh-TW have the same number of keys', () => {
    const counts = keySets.map((s) => `${s.name}=${s.keys.size}`).join(', ')
    const allSame = keySets.every((s) => s.keys.size === keySets[0].keys.size)
    expect(allSame).toBe(true)
    if (!allSame) {
      throw new Error(`Key counts differ: ${counts}`)
    }
  })

  it('en and zh-CN have identical key sets', () => {
    const enSet = keySets.find((s) => s.name === 'en')!.keys
    const zhCNSet = keySets.find((s) => s.name === 'zh-CN')!.keys
    const issues = [
      ...diffSets(enSet, zhCNSet, 'en', 'zh-CN'),
      ...diffSets(zhCNSet, enSet, 'zh-CN', 'en'),
    ]
    if (issues.length > 0) {
      throw new Error(`Key mismatch:\n${issues.join('\n')}`)
    }
  })

  it('en and zh-TW have identical key sets', () => {
    const enSet = keySets.find((s) => s.name === 'en')!.keys
    const zhTWSet = keySets.find((s) => s.name === 'zh-TW')!.keys
    const issues = [
      ...diffSets(enSet, zhTWSet, 'en', 'zh-TW'),
      ...diffSets(zhTWSet, enSet, 'zh-TW', 'en'),
    ]
    if (issues.length > 0) {
      throw new Error(`Key mismatch:\n${issues.join('\n')}`)
    }
  })

  it('all three locale files have at least 10 top-level sections', () => {
    // Ensure files look like full locale definition objects
    for (const l of locales) {
      const topLevelKeys = Object.keys(l.obj)
      expect(topLevelKeys.length).toBeGreaterThanOrEqual(10)
    }
  })
})
