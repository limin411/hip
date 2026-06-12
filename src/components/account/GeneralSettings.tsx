import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const
type LanguageKey = (typeof LANGUAGE_KEYS)[number]

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const currentLang: LanguageKey = LANGUAGE_KEYS.includes(i18n.language as LanguageKey)
    ? (i18n.language as LanguageKey)
    : LANGUAGE_KEYS[0]

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.language')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.languageDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <select
            value={currentLang}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-8 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
          >
            {LANGUAGE_KEYS.map((lang) => (
              <option key={lang} value={lang}>
                {t(`settings.languages.${lang}`)}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        </div>
      </div>
    </div>
  )
}
