import { PanelLeft, PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const sessions = useUiStore((s) => s.sessions)
  const activeSessionId = useUiStore((s) => s.activeSessionId)
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)
  const togglePanel = useUiStore((s) => s.togglePanel)

  const active = sessions.find((s) => s.id === activeSessionId)

  return (
    <div className="mx-2 mb-2 flex h-12 shrink-0 items-center justify-between rounded-xl border border-border bg-surface px-4 shadow-pop">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleCollapsed} title="折叠侧边栏">
          <PanelLeft size={17} />
        </Button>
        <span className="text-[13px] font-medium text-ink">{active?.title ?? '对话'}</span>
      </div>
      <Button variant="ghost" size="icon" onClick={togglePanel} title="切换产物面板">
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
