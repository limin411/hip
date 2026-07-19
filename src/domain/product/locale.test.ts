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
    expect(resolveProductHelpLocale('ja')).toBe('ja')
    expect(resolveProductHelpLocale('ja-JP')).toBe('ja')
    expect(resolveProductHelpLocale('ko')).toBe('ko')
    expect(resolveProductHelpLocale('ko-KR')).toBe('ko')
    expect(resolveProductHelpLocale('fr')).toBe('en')
    expect(resolveProductHelpLocale(undefined)).toBe('en')
  })

  it('ships en, zh-CN, zh-TW, ja, ko packs with same section ids', () => {
    const en = PRODUCT_HELP_LOCALES.en
    for (const loc of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const) {
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

  it('ja and ko packs are target-language, not English copies', () => {
    const en = getProductHelpPack('en')
    const ja = getProductHelpPack('ja')
    const ko = getProductHelpPack('ko')
    expect(ja.capabilityMap).not.toBe(en.capabilityMap)
    expect(ko.capabilityMap).not.toBe(en.capabilityMap)
    expect(ja.capabilityMap).toMatch(/[\u3040-\u30ff\u3400-\u9fff]/)
    expect(ko.capabilityMap).toMatch(/[\uac00-\ud7af]/)
    expect(ja.description).toMatch(/[\u3040-\u30ff\u3400-\u9fff]/)
    expect(ko.description).toMatch(/[\uac00-\ud7af]/)
  })
})
