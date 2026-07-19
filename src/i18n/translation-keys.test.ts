// src/i18n/translation-keys.test.ts
import { describe, it, expect } from 'vitest'
import { en } from './en'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'
import { ja } from './ja'
import { ko } from './ko'
import { SLASH_BUILTIN_COMMANDS } from '@/domain/commands/slashBuiltins'
import { listCatalogItems } from '@/components/context-menu/catalog'

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

function deepGet(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function diffSets(a: Set<string>, b: Set<string>, labelA: string, labelB: string): string[] {
  const issues: string[] = []
  for (const key of a) {
    if (!b.has(key)) issues.push(`Key "${key}" exists in ${labelA} but not in ${labelB}`)
  }
  return issues
}

/** Hiragana / Katakana / CJK Unified Ideographs (covers Japanese UI). */
const JA_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/
/** Hangul syllables / jamo. */
const KO_SCRIPT = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/

describe('Translation key consistency', () => {
  const locales = [
    { name: 'en', obj: en.translation },
    { name: 'zh-CN', obj: zhCN.translation },
    { name: 'zh-TW', obj: zhTW.translation },
    { name: 'ja', obj: ja.translation },
    { name: 'ko', obj: ko.translation },
  ]

  const keySets = locales.map((l) => ({
    name: l.name,
    keys: new Set(deepKeys(l.obj as Record<string, unknown>)),
  }))

  it('all app locales have the same number of keys', () => {
    const counts = keySets.map((s) => `${s.name}=${s.keys.size}`).join(', ')
    const allSame = keySets.every((s) => s.keys.size === keySets[0].keys.size)
    expect(allSame).toBe(true)
    if (!allSame) {
      throw new Error(`Key counts differ: ${counts}`)
    }
  })

  for (const name of ['zh-CN', 'zh-TW', 'ja', 'ko'] as const) {
    it(`en and ${name} have identical key sets`, () => {
      const enSet = keySets.find((s) => s.name === 'en')!.keys
      const other = keySets.find((s) => s.name === name)!.keys
      const issues = [
        ...diffSets(enSet, other, 'en', name),
        ...diffSets(other, enSet, name, 'en'),
      ]
      if (issues.length > 0) {
        throw new Error(`Key mismatch:\n${issues.join('\n')}`)
      }
    })
  }

  it('all locale files have at least 10 top-level sections', () => {
    for (const l of locales) {
      const topLevelKeys = Object.keys(l.obj)
      expect(topLevelKeys.length).toBeGreaterThanOrEqual(10)
    }
  })

  it('every built-in slash command has chat.slash.cmd.<id> in all locales', () => {
    for (const { name, keys } of keySets) {
      for (const cmd of SLASH_BUILTIN_COMMANDS) {
        const key = `chat.slash.cmd.${cmd.id}`
        expect(keys.has(key), `${name} missing ${key}`).toBe(true)
      }
    }
  })

  it('every context-menu catalog labelKey exists in all locales', () => {
    const labelKeys = [...new Set(listCatalogItems().map((item) => item.labelKey))]
    expect(labelKeys.length).toBeGreaterThan(0)
    for (const { name, keys } of keySets) {
      const missing = labelKeys.filter((key) => !keys.has(key))
      expect(missing, `${name} missing catalog labelKeys:\n${missing.join('\n')}`).toEqual([])
    }
  })

  it('ja primary UI strings use Japanese script (not English copies)', () => {
    const sampleKeys = [
      'settings.title',
      'settings.language',
      'chat.title',
      'chat.newChat',
    ]
    for (const key of sampleKeys) {
      const val = deepGet(ja.translation as Record<string, unknown>, key)
      expect(typeof val, key).toBe('string')
      expect(String(val), key).toMatch(JA_SCRIPT)
      const enVal = deepGet(en.translation as Record<string, unknown>, key)
      expect(val, key).not.toBe(enVal)
    }
    // Language endonyms are shared across locale packs
    expect(deepGet(ja.translation as Record<string, unknown>, 'settings.languages.ja')).toBe(
      '日本語',
    )
    expect(deepGet(ja.translation as Record<string, unknown>, 'settings.languages.ko')).toBe(
      '한국어',
    )
  })

  it('ko primary UI strings use Hangul (not English copies)', () => {
    const sampleKeys = [
      'settings.title',
      'settings.language',
      'chat.title',
      'chat.newChat',
    ]
    for (const key of sampleKeys) {
      const val = deepGet(ko.translation as Record<string, unknown>, key)
      expect(typeof val, key).toBe('string')
      expect(String(val), key).toMatch(KO_SCRIPT)
      const enVal = deepGet(en.translation as Record<string, unknown>, key)
      expect(val, key).not.toBe(enVal)
    }
    expect(deepGet(ko.translation as Record<string, unknown>, 'settings.languages.ja')).toBe(
      '日本語',
    )
    expect(deepGet(ko.translation as Record<string, unknown>, 'settings.languages.ko')).toBe(
      '한국어',
    )
  })

  it('every locale exposes settings.languages for all app languages', () => {
    for (const { name, obj } of locales) {
      for (const lang of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']) {
        const val = deepGet(obj as Record<string, unknown>, `settings.languages.${lang}`)
        expect(typeof val, `${name} settings.languages.${lang}`).toBe('string')
        expect(String(val).length, `${name} settings.languages.${lang}`).toBeGreaterThan(0)
      }
    }
  })
})
