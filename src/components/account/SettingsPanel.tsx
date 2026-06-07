import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const

export function SettingsPanel() {
  const { t, i18n } = useTranslation()
  const currentLang = LANGUAGE_KEYS.includes(i18n.language as (typeof LANGUAGE_KEYS)[number])
    ? (i18n.language as (typeof LANGUAGE_KEYS)[number])
    : LANGUAGE_KEYS[0]

  const cycleLanguage = () => {
    const idx = LANGUAGE_KEYS.indexOf(currentLang)
    const nextIdx = idx >= 0 ? (idx + 1) % LANGUAGE_KEYS.length : 0
    i18n.changeLanguage(LANGUAGE_KEYS[nextIdx])
  }

  return (
    <div className="flex items-center justify-between px-6 py-5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">{t('settings.language')}</div>
        <div className="mt-0.5 text-[12px] text-ink-tertiary">{t('settings.languageDesc')}</div>
      </div>
      <button
        className="ml-4 flex shrink-0 items-center gap-1 text-[13px] text-ink-secondary transition-colors hover:text-ink"
        onClick={cycleLanguage}
      >
        {t(`settings.languages.${currentLang}`)}
        <ChevronRight size={14} className="text-ink-tertiary" />
      </button>
    </div>
  )
}
