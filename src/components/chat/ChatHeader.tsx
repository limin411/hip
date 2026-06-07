import { PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { useActiveSession, useConnectionStatus, useHasApiKey, sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'

const DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-ink-tertiary',
  error: 'bg-red-500',
}

export function ChatHeader() {
  const { t } = useTranslation()
  const togglePanel = useUiStore((s) => s.togglePanel)
  const active = useActiveSession()
  const status = useConnectionStatus()
  const hasApiKey = useHasApiKey()

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-border bg-surface pl-14 pr-3"
    >
      <span className="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-[13px] font-medium text-ink">
        {active?.title ?? t('chat.title')}
      </span>
      <div className="flex items-center gap-1.5" data-tauri-drag-region="false">
        {status === 'connected' && !hasApiKey ? (
          <>
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-[11px] text-amber-600">{t('chat.noApiKey')}</span>
          </>
        ) : (
          <>
            <span className={`h-2 w-2 rounded-full ${DOT[status] ?? DOT.disconnected}`} />
            <span className="text-[11px] text-ink-tertiary">
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
                className="text-[11px] text-accent hover:underline"
              >
                {t('chat.connectionRetry')}
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePanel}
        title={t('chat.togglePanel')}
        data-tauri-drag-region="false"
        data-testid="toggle-panel"
      >
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
