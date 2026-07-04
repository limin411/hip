import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { SessionTabBar } from '@/components/tabs/SessionTabBar'
import { ConnectionStatus } from './ConnectionStatus'
import { PanelToggle } from './PanelToggle'

/**
 * 全宽标题栏 —— 应用唯一的横向 chrome 行：
 *   红绿灯让位区 | 会话标签栏 | 右侧连接状态/面板切换
 * 各列（菜单栏、侧栏、对话、产物）一律渲染在本行之下，不再单独叠头。
 */
export function TitleBar() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const onNewSession = useCallback(() => useDomainStore.getState().deselect(), [])

  return (
    <header
      data-tauri-drag-region
      data-testid="titlebar"
      className="relative flex h-11 shrink-0 items-center border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl shadow-sticky-top"
    >
      {/* 为 macOS 红绿灯整簇让位（约 x19→77），留足间距后再放内容，避免与绿灯相撞 */}
      <div className="shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />

      {activeView === 'settings' ? (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
          {t('settings.title')}
        </span>
      ) : (
        <>
          <SessionTabBar onNewSession={onNewSession} />
          <div className="flex shrink-0 items-center gap-2 pr-3" data-tauri-drag-region="false">
            <ConnectionStatus />
            <PanelToggle />
          </div>
        </>
      )}
    </header>
  )
}
