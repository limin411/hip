import { useTranslation } from 'react-i18next'
import { HipLogo } from '@/components/login/HipLogo'

export function DomainPane() {
  const { t } = useTranslation()
  return (
    <div
      data-testid="domain-pane"
      className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5"
    >
      <div className="w-full max-w-3xl">
        <div className="mb-6 flex justify-center">
          <HipLogo variant="hero" size={160} />
        </div>
        <h1 className="mb-1 text-center text-display font-semibold text-ink">
          Domain coming soon
        </h1>
        <p className="text-center text-body text-ink-secondary">
          {t('chat.greetingSub.default', '')}
        </p>
      </div>
    </div>
  )
}
