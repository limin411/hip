import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'

interface LanguageProviderProps {
  children: React.ReactNode
}

/**
 * Keeps i18next in sync with the persisted uiStore.language setting.
 * uiStore owns the preference; this component is the only place that calls changeLanguage.
 */
export function LanguageProvider({ children }: LanguageProviderProps) {
  const language = useUiStore((s) => s.language)
  const { i18n } = useTranslation()

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language, i18n])

  return <>{children}</>
}
