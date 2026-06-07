import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  const { t } = useTranslation()
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)

  return (
    <div className="flex h-full flex-col">
      {/* Drag region header: traffic light offset + hip label + collapse toggle */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-between px-4"
        style={{ paddingTop: 'var(--traffic-lights-offset, 40px)' }}
        aria-label="hip"
      >
        <span className="text-sm font-bold text-ink select-none">hip</span>
        <button
          onClick={toggleCollapsed}
          title={t('sidebar.collapse')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-ink"
          data-tauri-drag-region="false"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      {/* Rest of Sidebar: same as before */}
      <div className="flex flex-col gap-2 p-1.5">
        <NewChatButton />
        <SearchBox />
      </div>
      <div className="flex-1 overflow-y-auto px-1">
        <SessionList />
      </div>
      <div className="border-t border-border p-1.5">
        <UserMenu />
      </div>
    </div>
  )
}
