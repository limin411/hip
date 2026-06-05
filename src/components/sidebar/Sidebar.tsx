import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'

export function Sidebar() {
  const collapsed = useUiStore((s) => s.collapsed)

  return (
    <div className="flex h-full flex-col bg-surface-subtle">
      <div className="flex flex-col gap-2 p-2.5">
        <NewChatButton collapsed={collapsed} />
        {!collapsed && <SearchBox />}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {!collapsed && <SessionList />}
      </div>

      <div className="border-t border-border p-2.5">
        {!collapsed && <div className="text-[12px] text-ink-tertiary">用户菜单占位</div>}
      </div>
    </div>
  )
}
