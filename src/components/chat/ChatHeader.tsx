import { PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useActiveSession } from '@/domain'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const togglePanel = useUiStore((s) => s.togglePanel)
  const active = useActiveSession()

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-11 shrink-0 items-center border-b border-border bg-surface pl-14 pr-3"
    >
      <span className="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-[13px] font-medium text-ink">
        {active?.title ?? '对话'}
      </span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePanel}
        title="切换产物面板"
        data-tauri-drag-region="false"
      >
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
