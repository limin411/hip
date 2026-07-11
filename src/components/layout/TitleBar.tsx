import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain'
import { useWindowDrag } from '@/lib/useWindowDrag'
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
  const previousView = useUiStore((s) => s.previousView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const onNewSession = useCallback(() => useDomainStore.getState().deselect(), [])
  const handlePointerDown = useWindowDrag()

  const handleBack = () => {
    setActiveView(previousView ?? 'chat')
  }

  const isSpecialView = activeView === 'settings' || activeView === 'history'
  const titleKey = activeView === 'settings' ? 'settings.title' : 'history.title'

  return (
    <header
      data-tauri-drag-region
      data-testid="titlebar"
      onPointerDown={handlePointerDown}
      className="relative flex h-11 shrink-0 items-center bg-glass backdrop-blur-xl"
    >
      {/* 为 macOS 红绿灯整簇让位（约 x19→77），留足间距后再放内容，避免与绿灯相撞 */}
      <div className="shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />

      {isSpecialView ? (
        <>
          <button
            type="button"
            data-testid="titlebar-back"
            data-tauri-drag-region="false"
            data-no-drag
            onClick={handleBack}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <ChevronLeft size={16} />
            {t('common.back')}
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
            {t(titleKey)}
          </span>
          <div className="ml-auto shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />
        </>
      ) : (
        <>
          <SessionTabBar onNewSession={onNewSession} />
          <div className="flex shrink-0 items-center gap-2 pr-3">
            <ConnectionStatus />
            <PanelToggle />
          </div>
        </>
      )}
    </header>
  )
}
