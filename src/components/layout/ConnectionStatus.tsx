import { useTranslation } from 'react-i18next'
import { useConnectionStatus, useHasApiKey, sessionService } from '@/domain'

const DOT: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning animate-pulse',
  disconnected: 'bg-ink-tertiary',
  error: 'bg-danger',
}

export function ConnectionStatus() {
  const { t } = useTranslation()
  const status = useConnectionStatus()
  const hasApiKey = useHasApiKey()

  return (
    <div className="flex items-center gap-2 pl-2" data-tauri-drag-region="false">
      {status === 'connected' && !hasApiKey ? (
        <>
          <span className="h-2 w-2 rounded-full bg-warning" />
          <span className="text-caption text-warning">{t('chat.noApiKey')}</span>
        </>
      ) : (
        <>
          <span className={`h-2 w-2 rounded-full transition-colors ${DOT[status] ?? DOT.disconnected}`} />
          <span className="text-caption text-ink-tertiary">
            {{
              connecting: t('chat.connectionConnecting'),
              connected: t('chat.connectionConnected'),
              disconnected: t('chat.connectionDisconnected'),
              error: t('chat.connectionError'),
            }[status] ?? t('chat.connectionDisconnected')}
          </span>
          {(status === 'error' || status === 'disconnected') && (
            <button
              onClick={() => sessionService.reconnect()}
              className="text-caption text-accent-strong transition-colors hover:text-accent-hover hover:underline"
            >
              {t('chat.connectionRetry')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
