import { PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { useActiveSession, useConnectionStatus, useHasApiKey, useActiveUsageTotal, sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { useProvidersStore } from '@/store/providersStore'
import { computeCost, formatUsd } from '@/lib/usageCost'

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
  const usageTotal = useActiveUsageTotal()
  const activeRate = useProvidersStore((s) => {
    const am = s.config.activeModel
    return am ? s.catalog[am.providerID]?.models[am.modelID]?.cost : undefined
  })

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-border bg-surface pl-14 pr-3"
    >
      <span className="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-body font-medium text-ink">
        {active?.title ?? t('chat.title')}
      </span>
      <div className="flex items-center gap-2" data-tauri-drag-region="false">
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
      {usageTotal && (
        <span
          data-testid="session-usage"
          title={t('chat.usage.sessionTotal')}
          data-tauri-drag-region="false"
          className="ml-3 rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-ink-tertiary"
        >
          {t('chat.usage.tokens', { total: usageTotal.totalTokens })}
          {(() => {
            const cost = computeCost(usageTotal, activeRate)
            return cost === null ? null : ` · ${t('chat.usage.cost', { cost: formatUsd(cost) })}`
          })()}
        </span>
      )}
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
