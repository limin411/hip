import { PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

/**
 * 设置视图下的「折叠/展开分类侧栏」按钮。
 * 会话侧栏已随新布局移除，此按钮仅在设置页保留原有行为。
 */
export function SidebarToggle() {
  const { t } = useTranslation()
  const isSettings = useUiStore((s) => s.activeView === 'settings')
  const collapsed = useUiStore((s) => s.settingsNavCollapsed)
  const toggleSettings = useUiStore((s) => s.toggleSettingsNav)

  const label = collapsed ? t('sidebar.expand') : t('sidebar.collapse')

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={() => isSettings && toggleSettings()}
      title={label}
      aria-label={label}
      aria-pressed={collapsed}
      data-tauri-drag-region="false"
    >
      <PanelLeft size={16} />
    </Button>
  )
}
