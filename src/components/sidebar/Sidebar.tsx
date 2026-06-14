import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'

export function Sidebar() {
  const { t } = useTranslation()
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：红绿灯偏移 + 折叠按钮（品牌标志已移至菜单栏） */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-end px-2"
        style={{ paddingTop: 'var(--traffic-lights-offset, 40px)' }}
      >
        <button
          onClick={toggleCollapsed}
          title={t('sidebar.collapse')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-ink"
          data-tauri-drag-region="false"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-2.5 p-2">
        <NewChatButton />
        <SearchBox />
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        <SessionList />
      </div>
    </div>
  )
}
