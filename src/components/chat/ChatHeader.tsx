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
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3"
    >
      <span className="min-w-0 truncate text-[13px] font-medium text-ink">
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
