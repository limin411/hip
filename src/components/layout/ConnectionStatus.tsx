import { useTranslation } from 'react-i18next'
import { useConnectionStatus, useHasApiKey, sessionService } from '@/domain'
import { cn } from '@/lib/utils'

const TONE: Record<string, { dot: string; chip: string }> = {
  connected: { dot: 'bg-success', chip: 'bg-success/10 text-success' },
  connecting: { dot: 'bg-warning animate-pulse', chip: 'bg-warning/10 text-warning' },
  disconnected: { dot: 'bg-ink-tertiary', chip: 'bg-surface-muted text-ink-tertiary' },
  error: { dot: 'bg-danger', chip: 'bg-danger/10 text-danger' },
}

export function ConnectionStatus() {
  const { t } = useTranslation()
  const status = useConnectionStatus()
  const hasApiKey = useHasApiKey()

  const tone = TONE[status] ?? TONE.disconnected
  const noApiKey = status === 'connected' && !hasApiKey

  return (
    <div
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2',
        noApiKey ? 'bg-warning/10 text-warning' : tone.chip,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
          noApiKey ? 'bg-warning' : tone.dot,
        )}
        aria-hidden
      />
      <span className="text-caption leading-none">
        {noApiKey
          ? t('chat.noApiKey')
          : {
              connecting: t('chat.connectionConnecting'),
              connected: t('chat.connectionConnected'),
              disconnected: t('chat.connectionDisconnected'),
              error: t('chat.connectionError'),
            }[status] ?? t('chat.connectionDisconnected')}
      </span>
      {(status === 'error' || status === 'disconnected') && (
        <button
          data-tauri-drag-region="false"
          data-no-drag
          onClick={() => sessionService.reconnect()}
          className="text-caption leading-none text-accent-strong transition-colors hover:text-accent-hover hover:underline"
        >
          {t('chat.connectionRetry')}
        </button>
      )}
    </div>
  )
}
