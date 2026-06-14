import { PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'

/**
 * 统一的「折叠/展开侧栏」按钮 —— 常驻标题栏左侧、全局唯一位置。
 * 按当前视图分派：对话视图控制会话侧栏（collapsed），设置视图控制分类侧栏（settingsNavCollapsed）。
 * 收起后按钮仍在原位，可一键恢复，两个视图行为与位置完全一致。
 */
export function SidebarToggle() {
  const { t } = useTranslation()
  const isSettings = useUiStore((s) => s.activeView === 'settings')
  const collapsed = useUiStore((s) => (s.activeView === 'settings' ? s.settingsNavCollapsed : s.collapsed))
  const toggleChat = useUiStore((s) => s.toggleCollapsed)
  const toggleSettings = useUiStore((s) => s.toggleSettingsNav)

  const label = collapsed ? t('sidebar.expand') : t('sidebar.collapse')

  return (
    <button
      type="button"
      onClick={() => (isSettings ? toggleSettings() : toggleChat())}
      title={label}
      aria-label={label}
      aria-pressed={collapsed}
      data-tauri-drag-region="false"
      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <PanelLeft size={16} />
    </button>
  )
}
