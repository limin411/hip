import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { SettingsPanel } from './SettingsPanel'

export function SettingsPage() {
  const { t } = useTranslation()
  const navRef = useRef<ImperativePanelHandle>(null)
  const [navCollapsed, setNavCollapsed] = useState(false)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3"
      >
        {/* 最小化/展开分类侧栏 —— 常驻于标题栏，收起后仍可一键恢复（对齐对话列表的折叠交互）。 */}
        <button
          onClick={() => (navCollapsed ? navRef.current?.expand() : navRef.current?.collapse())}
          title={navCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          data-tauri-drag-region="false"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <PanelLeft size={16} />
        </button>
        <span className="text-body font-medium text-ink">{t('settings.title')}</span>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsPanel navRef={navRef} onNavCollapsedChange={setNavCollapsed} />
      </div>
    </div>
  )
}
