import { useTranslation } from 'react-i18next'
import { HipLogo } from '@/components/login/HipLogo'

export function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div
      className="flex h-dvh w-screen flex-col items-center justify-center gap-4 bg-surface text-ink-secondary"
      data-testid="loading-screen"
    >
      <div className="animate-pulse">
        <HipLogo size={40} decorative />
      </div>
      <span className="text-body text-ink-tertiary">{t('chat.loading')}</span>
    </div>
  )
}
