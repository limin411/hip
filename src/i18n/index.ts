import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import * as reactI18next from 'react-i18next'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'

// Tests that partially mock react-i18next may not provide initReactI18next;
// the i18n instance itself must still load so domain code can read language.
const i18nChain = i18n.use(LanguageDetector)
const reactBinding = (reactI18next as { initReactI18next?: unknown }).initReactI18next
if (typeof reactBinding !== 'undefined') {
  i18nChain.use(reactBinding as never)
}
i18nChain.init({
    resources: {
      'zh-CN': zhCN,
      'zh-TW': zhTW,
      en,
      ja,
      ko,
    },
    fallbackLng: 'zh-CN',
    // Exact codes only. Do NOT enable nonExplicitSupportedLngs: it breaks lookup for
    // region-tagged locales like zh-CN / zh-TW (bundle exists but t() returns keys).
    // Browser tags (en-US, zh, ja-JP, ko-KR, …) are normalized in uiStore / LanguageProvider instead.
    supportedLngs: ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
