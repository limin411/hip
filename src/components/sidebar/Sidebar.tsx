import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  const collapsed = useUiStore((s) => s.collapsed)

  return (
    <div className={cn('flex h-full flex-col bg-surface-subtle', collapsed && 'items-center')}>
      <div className={cn('flex flex-col gap-2', collapsed ? 'p-1.5' : 'p-2.5')}>
        <NewChatButton collapsed={collapsed} />
        {!collapsed && <SearchBox />}
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {!collapsed && <SessionList />}
      </div>

      <div className={cn('border-t border-border', collapsed ? 'p-1.5' : 'p-2')}>
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  )
}
