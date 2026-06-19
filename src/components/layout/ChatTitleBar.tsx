import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import {
  useActiveSession,
  useConnectionStatus,
  useHasApiKey,
  useActiveUsageTotal,
  sessionService,
} from '@/domain'
import { Button } from '@/components/ui/Button'

const DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-ink-tertiary',
  error: 'bg-red-500',
}

/**
 * 对话视图对标题栏的贡献：左侧连接状态 + token 用量、居中会话标题、右侧产物面板切换。
 * 不再渲染单独的 h-11 头行 —— 直接作为 TitleBar 的子内容嵌入到全宽标题栏。
 */
export function ChatTitleBar() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
  const onTogglePanel = activeView === 'code' ? togglePanel : toggleChatPanel
  const active = useActiveSession()
  const status = useConnectionStatus()
  const hasApiKey = useHasApiKey()
  const usageTotal = useActiveUsageTotal()

  return (
    <>
      <div className="flex items-center gap-2 pl-2" data-tauri-drag-region="false">
        {status === 'connected' && !hasApiKey ? (
          <>
            <span className="h-2 w-2 rounded-full bg-warning" />
            <span className="text-caption text-warning">{t('chat.noApiKey')}</span>
          </>
        ) : (
          <>
            <span
              className={`h-2 w-2 rounded-full transition-colors ${DOT[status] ?? DOT.disconnected}`}
            />
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
        </span>
      )}

      <span className="pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate text-body font-medium text-ink">
        {active?.title ?? t('chat.title')}
      </span>

      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={onTogglePanel}
        title={t('chat.togglePanel')}
        data-tauri-drag-region="false"
        data-testid="toggle-panel"
        className="mr-2"
      >
        <PanelRight size={17} />
      </Button>
    </>
  )
}
