import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { SidebarToggle } from './SidebarToggle'
import { ChatTitleBar } from './ChatTitleBar'

/**
 * 全宽标题栏 —— 应用唯一的横向 chrome 行：
 *   红绿灯让位区 | 折叠侧栏按钮（统一） | 视图特定内容（状态/标题/操作）
 * 各列（菜单栏、侧栏、对话、产物）一律渲染在本行之下，不再单独叠头。
 */
export function TitleBar() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-border bg-surface"
    >
      {/* 为 macOS 红绿灯整簇让位（约 x19→77），留足间距后再放折叠按钮，避免与绿灯相撞 */}
      <div className="shrink-0" style={{ width: 'var(--titlebar-lights-inset, 90px)' }} aria-hidden />
      <SidebarToggle />

      {activeView === 'chat' ? (
        <ChatTitleBar />
      ) : (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
          {t('settings.title')}
        </span>
      )}
    </header>
  )
}
