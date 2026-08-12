import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HipLogo } from '@/components/login/HipLogo'

export function LoadingScreen() {
  const { t } = useTranslation()
  // Stable wall-clock start for the live elapsed readout (P1-3).
  const [startedAt] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])

  return (
    <div
      className="flex h-dvh w-screen flex-col items-center justify-center gap-4 bg-surface text-ink-secondary"
      data-testid="loading-screen"
    >
      <div className="animate-pulse">
        <HipLogo size={40} decorative />
      </div>
      <div className="flex items-center gap-2.5">
        <span className="px-grid text-ink-secondary" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="text-body text-ink-tertiary">{t('chat.loading')}</span>
        <span className="font-mono tabular-nums text-meta text-ink-tertiary" data-testid="loading-elapsed">
          {elapsed}s
        </span>
      </div>
    </div>
  )
}
