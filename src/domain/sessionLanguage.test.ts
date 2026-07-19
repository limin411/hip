/**
 * Session language resolution: UI AppLanguage must pass through into protocol
 * SessionConfig.language (including ja / ko), not collapse to en.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { SessionConfig } from '@hip/protocol'
import { normalizeSessionConfig } from '@hip/protocol'
import i18n from '@/i18n'
import { normalizeAppLanguage, type AppLanguage } from '@/store/uiStore'
import { currentLanguage } from './sessionService'

describe('session language (ja/ko)', () => {
  let prevLng: string | undefined

  beforeEach(() => {
    prevLng = i18n.language
  })

  afterEach(async () => {
    if (prevLng) await i18n.changeLanguage(prevLng)
  })

  it('normalizeAppLanguage accepts ja/ko and region tags', () => {
    expect(normalizeAppLanguage('ja')).toBe('ja')
    expect(normalizeAppLanguage('ja-JP')).toBe('ja')
    expect(normalizeAppLanguage('ko')).toBe('ko')
    expect(normalizeAppLanguage('ko-KR')).toBe('ko')
    expect(normalizeAppLanguage('fr')).toBeNull()
  })

  it('currentLanguage preserves ja and ko from i18n (shipped session path)', async () => {
    await i18n.changeLanguage('ja')
    expect(currentLanguage()).toBe('ja')
    await i18n.changeLanguage('ko')
    expect(currentLanguage()).toBe('ko')
    await i18n.changeLanguage('en')
    expect(currentLanguage()).toBe('en')
  })

  it('SessionConfig accepts ja/ko language and normalizeSessionConfig keeps them', () => {
    for (const language of ['ja', 'ko'] as const) {
      const cfg: SessionConfig = {
        llmProvider: 'deepseek',
        model: 'deepseek-chat',
        tools: [],
        language,
      }
      const out = normalizeSessionConfig(cfg)
      expect(out.language).toBe(language)
    }
  })

  it('every AppLanguage maps to a protocol SessionConfig language', async () => {
    const appLangs: AppLanguage[] = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']
    for (const lang of appLangs) {
      await i18n.changeLanguage(lang)
      const sessionLang = currentLanguage()
      expect(sessionLang).toBe(lang)
      const cfg = normalizeSessionConfig({
        llmProvider: 'x',
        model: 'y',
        tools: [],
        language: sessionLang,
      })
      expect(cfg.language).toBe(lang)
    }
  })
})
