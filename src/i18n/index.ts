import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { zhCN } from './zh-CN'
import { zhTW } from './zh-TW'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
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
