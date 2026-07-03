import { useUiStore, type Surface } from '@/store/uiStore'
import { sessionService } from '@/domain'
import { SurfaceTabs } from './SurfaceTabs'
import { NewSessionButton } from './NewSessionButton'
import { SessionSearch } from './SessionSearch'
import { SessionList } from './SessionList'
import { AccountFooter } from './AccountFooter'

export function Sidebar() {
  const activeView = useUiStore((s) => s.activeView)
  const surface: Surface = activeView === 'code' ? 'code' : 'chat'

  return (
    <div data-testid="sidebar-root" className="flex h-full flex-col bg-[var(--glass-bg)] backdrop-blur-xl border-r border-[var(--glass-border)]">
      <div className="flex flex-col gap-2.5 p-3">
        <SurfaceTabs active={surface} onChange={(v) => sessionService.setSurface(v)} />
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <SessionSearch />
          </div>
          <NewSessionButton surface={surface} iconOnly />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <SessionList />
      </div>
      <div className="px-3 pb-3">
        <AccountFooter />
      </div>
    </div>
  )
}
