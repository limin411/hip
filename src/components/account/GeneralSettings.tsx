import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { isApiKeyConfigured, saveApiKey, clearApiKey, restartSidecar } from '@/ipc/secrets'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const
type LanguageKey = (typeof LANGUAGE_KEYS)[number]

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const currentLang: LanguageKey = LANGUAGE_KEYS.includes(i18n.language as LanguageKey)
    ? (i18n.language as LanguageKey)
    : LANGUAGE_KEYS[0]

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isApiKeyConfigured().then(setConfigured).catch(() => setConfigured(false))
  }, [])

  async function onSave() {
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      await saveApiKey(value.trim())
      await restartSidecar()
      setConfigured(true)
      setValue('')
    } catch (e) {
      console.error('[settings] save api key failed', e)
      setError(t('settings.apiKeyError'))
    } finally {
      setBusy(false)
    }
  }

  async function onClear() {
    setBusy(true)
    setError(null)
    try {
      await clearApiKey()
      await restartSidecar()
      setConfigured(false)
    } catch (e) {
      console.error('[settings] clear api key failed', e)
      setError(t('settings.apiKeyError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      {/* API key */}
      <div className="px-6 py-5">
        <div className="text-prose font-medium text-ink">{t('settings.apiKey')}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.apiKeyDesc')}</div>
        <div className="mt-1 text-meta">
          {configured
            ? <span className="text-success">{t('settings.apiKeyConfigured')}</span>
            : <span className="text-ink-tertiary">{t('settings.apiKeyNotConfigured')}</span>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('settings.apiKeyPlaceholder')}
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-body text-ink transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
          <button
            onClick={onSave}
            disabled={busy || !value.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t('settings.apiKeySave')}
          </button>
          <button
            onClick={onClear}
            disabled={busy || !configured}
            className="rounded-md border border-border px-3 py-1.5 text-body text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            {t('settings.apiKeyClear')}
          </button>
        </div>
        {error && <div className="mt-2 text-meta text-danger">{error}</div>}
      </div>

      {/* Language */}
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
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
        </div>
      </div>
    </div>
  )
}
