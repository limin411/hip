import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="flex h-dvh w-screen flex-col items-center justify-center gap-3 bg-surface text-ink-secondary">
      <Loader2 className="animate-spin text-accent-strong" size={24} aria-hidden />
      <span className="text-body">{t('chat.loading')}</span>
    </div>
  )
}
