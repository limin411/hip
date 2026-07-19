import { describe, expect, it } from 'vitest'
import {
  getProductHelpPack,
  resolveProductHelpLocale,
  PRODUCT_HELP_LOCALES,
} from './index'

describe('product help locales (P4)', () => {
  it('resolves BCP-47 tags', () => {
    expect(resolveProductHelpLocale('en')).toBe('en')
    expect(resolveProductHelpLocale('zh-CN')).toBe('zh-CN')
    expect(resolveProductHelpLocale('zh-TW')).toBe('zh-TW')
    expect(resolveProductHelpLocale('zh')).toBe('zh-CN')
    expect(resolveProductHelpLocale('zh-HK')).toBe('zh-TW')
    expect(resolveProductHelpLocale('fr')).toBe('en')
    expect(resolveProductHelpLocale(undefined)).toBe('en')
  })

  it('ships en, zh-CN, zh-TW packs with same section ids', () => {
    const en = PRODUCT_HELP_LOCALES.en
    for (const loc of ['en', 'zh-CN', 'zh-TW'] as const) {
      const pack = PRODUCT_HELP_LOCALES[loc]
      expect(pack.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id))
      expect(pack.capabilityMap.length).toBeGreaterThan(40)
      expect(pack.description.length).toBeGreaterThan(20)
    }
  })

  it('zh packs are not English copies', () => {
    const en = getProductHelpPack('en')
    const cn = getProductHelpPack('zh-CN')
    const tw = getProductHelpPack('zh-TW')
    expect(cn.capabilityMap).not.toBe(en.capabilityMap)
    expect(tw.capabilityMap).not.toBe(en.capabilityMap)
    expect(cn.capabilityMap).toMatch(/版本|产品/)
    expect(tw.capabilityMap).toMatch(/版本|產品/)
  })
})
